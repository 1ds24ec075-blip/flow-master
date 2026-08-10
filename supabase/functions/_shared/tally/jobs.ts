/**
 * Turns a bill into the set of sync jobs Tally needs, in dependency order.
 *
 * This is the only place that decides *what* to sync. The serializer decides
 * how it's rendered; the agent decides when it's pushed.
 */
import {
  type JobPayload,
  type MasterJob,
  type MasterLedgerJob,
  type MasterStockItemJob,
  type VoucherJob,
  type VoucherLineItem,
  type VoucherTaxLine,
  TallyReviewRequired,
  TallyValidationError,
  isVoucherJob,
} from "./types.ts";
import { toTallyDate } from "./serializer.ts";
import { deterministicGuid } from "./guid.ts";
import {
  matchStockItem,
  matchVendorLedger,
  VENDOR_LEDGER_GROUP,
  type KnownStockItem,
  type KnownVendorLedger,
  type MasterMatch,
  type MatchResolution,
} from "./matching.ts";

export { deterministicGuid };

export const DEFAULT_STOCK_UNIT = "Nos";
export const BILL_STOCK_GROUP_NAME = "Bill Items";
export const PURCHASE_LEDGER_NAME = "Purchase Account";
export const INPUT_CGST_LEDGER_NAME = "Input CGST";
export const INPUT_SGST_LEDGER_NAME = "Input SGST";
export const INPUT_IGST_LEDGER_NAME = "Input IGST";

/**
 * Standard 15-character GSTIN: state code, PAN, entity number, 'Z', checksum.
 * Mirrors the CHECK constraint on companies.gstin — if you change one, change
 * the other.
 */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * How far the inferred tax (total − items) may drift from the tax the line
 * items' own rates predict before the bill is parked for review, in rupees.
 * Covers per-line rounding; anything larger is a missed item or freight.
 */
export const TAX_MISMATCH_TOLERANCE = 1.0;

/** The first two characters of a GSTIN are the state code. */
export function stateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

export interface BillSyncOptions {
  /**
   * Two-digit state code of the company making the purchase, from its own
   * GSTIN. Required, and deliberately not defaulted: guessing it means
   * guessing between CGST/SGST and IGST, which is the bug this exists to fix.
   */
  companyStateCode: string;
  /**
   * Vendor ledgers Tally already holds. Supplying them lets a bill post to the
   * existing ledger instead of creating a near-duplicate under a slightly
   * different spelling. Empty means "we know of none", which reproduces the
   * old create-everything behaviour.
   */
  knownVendorLedgers?: KnownVendorLedger[];
  /** Stock items Tally already holds. Same reasoning as above. */
  knownStockItems?: KnownStockItem[];
  /**
   * Human answers to previously-ambiguous matches, keyed on the exact
   * normalized name. A hit skips the fuzzy logic entirely — matched adopts the
   * chosen master, distinct goes straight to create — so the same judgment
   * call is made once, not once per bill.
   */
  matchResolutions?: MatchResolution[];
}

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

/**
 * Narrows a bill's jobs down to the ones that actually need queueing.
 *
 * Re-enqueuing writes status 'pending', so anything already delivered would be
 * dragged back into the queue. For a master that is only churn. For the voucher
 * it means asking Tally to book the same purchase twice, and nothing downstream
 * reliably prevents that: Tally does not treat a caller-supplied GUID as an
 * idempotency key on ACTION="Create", so the sole remaining defence is the
 * agent's local delivered_guids table — which a reinstall or a lost queue.db
 * takes with it.
 *
 * `force` is the deliberate override, for a bill corrected after the fact whose
 * original voucher has been deleted in Tally by hand. Even then it only re-arms
 * the voucher: the masters are still there and still satisfy the dependency.
 */
export function jobsNeedingEnqueue(
  payloads: JobPayload[],
  deliveredGuids: ReadonlySet<string>,
  force = false,
): JobPayload[] {
  return payloads.filter((payload) => {
    if (!deliveredGuids.has(payload.guid)) return true;
    return force && isVoucherJob(payload);
  });
}

function round2(value: number | null | undefined): number {
  return Number(Number(value ?? 0).toFixed(2));
}

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

/**
 * Turns a match into the name to use, or stops the bill.
 *
 * `create` keeps whatever the bill said; `matched` adopts the name Tally
 * already has; `review` refuses to decide.
 */
function resolveMasterName(match: MasterMatch, fallback: string): string {
  if (match.kind === "matched") return match.name;
  if (match.kind === "review") throw new TallyReviewRequired(match.message, match.candidates);
  return fallback;
}

export function buildBillSyncJobs(
  bill: BillLike,
  rawItems: LineItemLike[],
  options: BillSyncOptions,
): BillSyncJobs {
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

  // A GSTIN is only written to Tally when it is actually well-formed. A bill
  // with no tax may still carry a garbled one from extraction, and putting that
  // in PARTYGSTIN helps nobody.
  const vendorGstin = bill.vendor_gst?.trim().toUpperCase() || null;
  const vendorGstinIsValid = vendorGstin !== null && GSTIN_PATTERN.test(vendorGstin);
  const partyGstin = vendorGstinIsValid ? vendorGstin : null;

  // Master identity, resolved against what Tally already holds.
  //
  // A master's identity in Tally is its name, and our GUIDs derive from that
  // name — so an extraction that says "Paper Plastic Packaging Pvt. Ltd." this
  // week and "Paper Plastic Packaging" next week silently opens a second ledger
  // and splits the vendor's balance across both. Matching resolves the bill
  // onto the name Tally already knows; everything downstream, including the
  // GUID, then follows that name.
  const partyLedgerName = resolveMasterName(
    matchVendorLedger(
      { name: partyLedger, gstin: partyGstin },
      options?.knownVendorLedgers ?? [],
      options?.matchResolutions,
    ),
    partyLedger,
  );

  const reference = (bill.bill_number || `BILL-${bill.id.slice(0, 8)}`).trim();
  const purchaseLedger = inferPurchaseLedger(bill);

  // A negative row is a discount or credit, and this pipeline has no correct
  // place to put one: silently dropping it (the old behaviour) inflated the
  // inferred tax by exactly its value, and posting it needs a credit-side
  // entry the voucher shape doesn't have. Refuse loudly instead.
  const negative = (rawItems ?? []).find((item) => amountFor(item) < 0);
  if (negative) {
    throw new TallyValidationError(
      `Line item "${(negative.item_description ?? "").trim() || "(unnamed)"}" has a negative amount (${amountFor(negative).toFixed(2)}). ` +
        "Discounts and credit rows are not supported — fold the discount into the item amounts and re-send.",
    );
  }

  const validItems = (rawItems ?? []).filter((item, index) => stockItemNameFor(item, index) && amountFor(item) > 0);
  const hasInventory = validItems.length > 0;

  const knownStockItems = options?.knownStockItems ?? [];
  const resolvedStockNames = validItems.map((item, index) => {
    const extracted = stockItemNameFor(item, index);
    return resolveMasterName(
      matchStockItem(extracted, knownStockItems, options?.matchResolutions),
      extracted,
    );
  });

  const lineItems: VoucherLineItem[] = validItems.map((item, index) => ({
    stockItemName: resolvedStockNames[index],
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

  // Cross-check the inferred tax against the rates extraction actually read.
  //
  // gstTotal is only "whatever the items don't explain" — which is GST when
  // extraction caught everything, and GST *plus* every missed line item,
  // freight charge and round-off when it didn't. When every line carries a
  // tax_rate the correct figure is computable, and a gap bigger than a rupee
  // means part of gstTotal is not tax; posting it as input credit would be
  // fiction that only surfaces at GSTR-2B. Runs only when all lines are rated
  // (a partial expectation proves nothing) and only when there is inferred tax
  // to test — a zero-GST bill stays out of review by prior decision.
  if (gstTotal > 0) {
    const rates = validItems.map((item) => (item.tax_rate == null ? null : Number(item.tax_rate)));
    if (rates.length > 0 && rates.every((rate) => rate !== null && Number.isFinite(rate))) {
      const expectedTax = round2(
        validItems.reduce((sum, item, index) => sum + (amountFor(item) * (rates[index] as number)) / 100, 0),
      );
      if (Math.abs(gstTotal - expectedTax) > TAX_MISMATCH_TOLERANCE) {
        throw new TallyReviewRequired(
          `Tax mismatch: the bill total implies ${gstTotal.toFixed(2)} of GST, but the line items' tax rates add up to ${expectedTax.toFixed(2)}. ` +
            "The difference is usually a missed line item, freight, or a discount. Review the line items or the total before sending.",
        );
      }
    }
  }

  // Place of supply.
  //
  // Only asked once there is tax to route. A bill with no GST — an unregistered
  // or composition supplier, or one that genuinely carries none — has no tax
  // line to put anywhere, so demanding a supplier GSTIN would block a sync that
  // has nothing to get wrong.
  //
  // When there IS tax, there is no safe default. Falling back to CGST/SGST
  // because the GSTIN is missing or unreadable is what produced vouchers that
  // don't reconcile against GSTR-2B: the entry posts, the books balance, and
  // the error only surfaces at filing. Such a bill goes back for review, in the
  // same way a missing supplier name or a zero total does.
  let isInterstate = false;
  if (gstTotal > 0) {
    const companyStateCode = options?.companyStateCode?.trim();
    if (!companyStateCode || !/^[0-9]{2}$/.test(companyStateCode)) {
      throw new TallyValidationError(
        "This Tally agent is not linked to a company with a valid GSTIN, so CGST/SGST and IGST cannot be told apart. Set the company GSTIN before syncing.",
      );
    }

    // Review, not a validation failure: the bill itself may be fine — the
    // GSTIN just didn't survive extraction — and the person fixing it needs
    // the bill parked at needs_review rather than bounced as bad data.
    if (!vendorGstin) {
      throw new TallyReviewRequired(
        "Cannot determine IGST vs CGST/SGST — the supplier GSTIN is missing. Add it to the bill and re-send.",
      );
    }
    if (!vendorGstinIsValid) {
      throw new TallyReviewRequired(
        `Cannot determine IGST vs CGST/SGST — supplier GSTIN "${bill.vendor_gst}" is not a valid 15-character GSTIN. Correct it and re-send.`,
      );
    }

    isInterstate = stateCodeFromGstin(vendorGstin) !== companyStateCode;
  }

  // Routing only. How much tax there is remains totalAmount - itemTotal above;
  // that inference is a separate problem and deliberately untouched here.
  const taxLines: VoucherTaxLine[] = [];
  if (gstTotal > 0) {
    if (isInterstate) {
      // One integrated levy, not two half-levies. Splitting an interstate
      // purchase into CGST/SGST claims credit under the wrong heads.
      taxLines.push({ ledgerName: INPUT_IGST_LEDGER_NAME, amount: gstTotal });
    } else {
      const cgst = round2(gstTotal / 2);
      taxLines.push({ ledgerName: INPUT_CGST_LEDGER_NAME, amount: cgst });
      taxLines.push({ ledgerName: INPUT_SGST_LEDGER_NAME, amount: round2(gstTotal - cgst) });
    }
  }

  const masters: MasterJob[] = [];

  const partyMaster: MasterLedgerJob = {
    // Derived from the RESOLVED name, so a bill matched onto an existing ledger
    // produces that ledger's GUID — which the enqueue filter then recognises as
    // already delivered and skips, rather than re-creating a near-duplicate.
    guid: deterministicGuid("ledger", partyLedgerName.toLowerCase()),
    masterType: "ledger",
    name: partyLedgerName,
    parentGroup: VENDOR_LEDGER_GROUP,
    gstin: partyGstin,
    gstRegistrationType: partyGstin ? "Regular" : null,
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

  // Only create the duty ledgers this voucher actually posts to — an
  // interstate bill has no business creating Input CGST/SGST.
  if (gstTotal > 0) {
    if (isInterstate) {
      masters.push({
        guid: deterministicGuid("ledger", INPUT_IGST_LEDGER_NAME.toLowerCase()),
        masterType: "ledger",
        name: INPUT_IGST_LEDGER_NAME,
        parentGroup: "Duties & Taxes",
        taxType: "GST",
        gstDutyHead: "Integrated Tax",
      });
    } else {
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
  }

  const seenStockItems = new Set<string>();
  validItems.forEach((item, index) => {
    // The resolved name, so two spellings of the same item on one bill collapse
    // to a single master instead of two.
    const name = resolvedStockNames[index];
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
    .map((item, index) => `${resolvedStockNames[index]} (${amountFor(item).toFixed(2)})`)
    .join(", ");
  const baseNarration = `Bill ${reference} from ${partyLedgerName}`;

  const voucher: VoucherJob = {
    guid: deterministicGuid("voucher", bill.id),
    voucherType: "Purchase",
    date: String(isoDate),
    voucherNumber: reference,
    reference,
    party: {
      ledgerName: partyLedgerName,
      gstin: partyGstin,
      gstRegistrationType: partyGstin ? "Regular" : null,
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
