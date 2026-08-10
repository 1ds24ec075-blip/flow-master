/**
 * Turns a bill into the set of sync jobs Tally needs, in dependency order.
 *
 * This is the only place that decides *what* to sync. The serializer decides
 * how it's rendered; the agent decides when it's pushed.
 */

import {
  type MasterJob,
  type MasterLedgerJob,
  type MasterStockItemJob,
  type VoucherJob,
  type VoucherLineItem,
  type VoucherTaxLine,
  TallyValidationError,
} from "./types.ts";
import { toTallyDate } from "./serializer.ts";

export const DEFAULT_STOCK_UNIT = "Nos";
export const BILL_STOCK_GROUP_NAME = "Bill Items";
export const PURCHASE_LEDGER_NAME = "Purchase Account";
export const INPUT_CGST_LEDGER_NAME = "Input CGST";
export const INPUT_SGST_LEDGER_NAME = "Input SGST";

export interface BillLike {
  id: string;
  bill_number?: string | null;
  vendor_name?: string | null;
  vendor_gst?: string | null;
  bill_date?: string | null;
  total_amount?: number | null;
  expense_categories?: { name?: string | null } | null;
}

export interface LineItemLike {
  item_description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  tax_rate?: number | null;
  amount?: number | null;
  hsn_code?: string | null;
}

export interface BillSyncJobs {
  masters: MasterJob[];
  voucher: VoucherJob;
}

function round2(value: number | null | undefined): number {
  return Number(Number(value ?? 0).toFixed(2));
}

/**
 * Re-exported so existing call sites keep working. The implementation lives in
 * guid.ts because matching.ts needs it too and this module imports matching.ts.
 */
export { deterministicGuid } from "./guid.ts";


export function stockItemNameFor(item: LineItemLike, index: number): string {
  return (item.item_description || `Bill Item ${index + 1}`).trim();
}

function quantityFor(item: LineItemLike): number {
  const quantity = round2(item.quantity);
  return quantity > 0 ? quantity : 1;
}

function amountFor(item: LineItemLike): number {
  return round2(item.amount ?? item.unit_price ?? 0);
}

function rateFor(item: LineItemLike): number {
  const explicit = round2(item.unit_price);
  if (explicit > 0) return explicit;
  return round2(amountFor(item) / quantityFor(item));
}

/** Maps an expense category onto the ledger the purchase should land in. */
export function inferPurchaseLedger(bill: BillLike): string {
  const categoryName = bill.expense_categories?.name?.trim();
  if (!categoryName) return PURCHASE_LEDGER_NAME;

  const normalized = categoryName.toLowerCase();
  if (normalized.includes("travel") || normalized.includes("transport")) return "Travelling Expenses";
  if (normalized.includes("utilities") || normalized.includes("electric")) return "Electricity Charges";
  if (normalized.includes("professional")) return "Professional Fees";
  if (normalized.includes("office")) return "Office Expenses";
  if (normalized.includes("maintenance") || normalized.includes("repair")) return "Repairs & Maintenance";
  if (normalized.includes("marketing") || normalized.includes("advertising")) return "Advertisement Expenses";

  return categoryName;
}

export function buildBillSyncJobs(bill: BillLike, rawItems: LineItemLike[]): BillSyncJobs {
  const partyLedger = bill.vendor_name?.trim();
  if (!partyLedger || partyLedger === "Processing...") {
    throw new TallyValidationError("Supplier name is missing or extraction is still running");
  }

  const totalAmount = round2(bill.total_amount);
  if (!(totalAmount > 0)) throw new TallyValidationError("Bill has no valid total amount");

  const isoDate = bill.bill_date;
  if (!toTallyDate(isoDate)) {
    throw new TallyValidationError("Bill date is missing or invalid");
  }

  const reference = (bill.bill_number || `BILL-${bill.id.slice(0, 8)}`).trim();
  const purchaseLedger = inferPurchaseLedger(bill);

  const validItems = (rawItems ?? []).filter((item, index) => stockItemNameFor(item, index) && amountFor(item) > 0);
  const hasInventory = validItems.length > 0;

  const lineItems: VoucherLineItem[] = validItems.map((item, index) => ({
    stockItemName: stockItemNameFor(item, index),
    quantity: quantityFor(item),
    unit: DEFAULT_STOCK_UNIT,
    rate: rateFor(item),
    amount: amountFor(item),
    purchaseLedger,
  }));

  const itemTotal = round2(lineItems.reduce((sum, item) => sum + item.amount, 0));
  // Whatever the line items don't account for is GST, split evenly across
  // CGST/SGST. With no line items there's no reliable split to infer.
  const gstTotal = hasInventory ? round2(totalAmount - itemTotal) : 0;
  if (gstTotal < 0) {
    throw new TallyValidationError(
      `Bill line items (${itemTotal.toFixed(2)}) exceed the bill total (${totalAmount.toFixed(2)})`,
    );
  }

  const taxLines: VoucherTaxLine[] = [];
  if (gstTotal > 0) {
    const cgst = round2(gstTotal / 2);
    taxLines.push({ ledgerName: INPUT_CGST_LEDGER_NAME, amount: cgst });
    taxLines.push({ ledgerName: INPUT_SGST_LEDGER_NAME, amount: round2(gstTotal - cgst) });
  }

  const masters: MasterJob[] = [];

  const partyMaster: MasterLedgerJob = {
    guid: deterministicGuid("ledger", partyLedger.toLowerCase()),
    masterType: "ledger",
    name: partyLedger,
    parentGroup: "Sundry Creditors",
    gstin: bill.vendor_gst ?? null,
    gstRegistrationType: bill.vendor_gst ? "Regular" : null,
    billWiseOn: true,
  };
  masters.push(partyMaster);

  const purchaseMaster: MasterLedgerJob = {
    guid: deterministicGuid("ledger", purchaseLedger.toLowerCase()),
    masterType: "ledger",
    name: purchaseLedger,
    parentGroup: "Purchase Accounts",
    gstApplicable: true,
  };
  masters.push(purchaseMaster);

  if (gstTotal > 0) {
    masters.push({
      guid: deterministicGuid("ledger", INPUT_CGST_LEDGER_NAME.toLowerCase()),
      masterType: "ledger",
      name: INPUT_CGST_LEDGER_NAME,
      parentGroup: "Duties & Taxes",
      taxType: "GST",
      gstDutyHead: "Central Tax",
    });
    masters.push({
      guid: deterministicGuid("ledger", INPUT_SGST_LEDGER_NAME.toLowerCase()),
      masterType: "ledger",
      name: INPUT_SGST_LEDGER_NAME,
      parentGroup: "Duties & Taxes",
      taxType: "GST",
      gstDutyHead: "State Tax",
    });
  }

  const seenStockItems = new Set<string>();
  validItems.forEach((item, index) => {
    const name = stockItemNameFor(item, index);
    const key = name.toLowerCase();
    if (seenStockItems.has(key)) return;
    seenStockItems.add(key);

    const stockMaster: MasterStockItemJob = {
      guid: deterministicGuid("stockitem", key),
      masterType: "stockItem",
      name,
      parentGroup: BILL_STOCK_GROUP_NAME,
      unit: DEFAULT_STOCK_UNIT,
      gstApplicable: true,
      hsnCode: item.hsn_code ?? null,
      taxability: item.tax_rate != null ? "Taxable" : null,
      cgstRate: item.tax_rate != null ? round2(Number(item.tax_rate) / 2) : null,
      sgstRate: item.tax_rate != null ? round2(Number(item.tax_rate) / 2) : null,
    };
    masters.push(stockMaster);
  });

  const itemDetails = validItems
    .map((item, index) => `${stockItemNameFor(item, index)} (${amountFor(item).toFixed(2)})`)
    .join(", ");
  const baseNarration = `Bill ${reference} from ${partyLedger}`;

  const voucher: VoucherJob = {
    guid: deterministicGuid("voucher", bill.id),
    voucherType: "Purchase",
    date: String(isoDate),
    voucherNumber: reference,
    reference,
    party: {
      ledgerName: partyLedger,
      gstin: bill.vendor_gst ?? null,
      gstRegistrationType: bill.vendor_gst ? "Regular" : null,
    },
    narration: itemDetails ? `${baseNarration}. Items: ${itemDetails}` : baseNarration,
    lineItems,
    taxLines,
    accountingLedger: purchaseLedger,
    totalAmount,
    dependsOnMasterGuids: masters.map((master) => master.guid),
  };

  return { masters, voucher };
}
