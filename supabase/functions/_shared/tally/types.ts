/**
 * Structured business data for Tally sync jobs.
 *
 * These types are the contract between the cloud backend (which produces jobs),
 * the sync queue (which stores them as JSON), and the serializer (which renders
 * them to XML at send time). Nothing upstream of the serializer should ever
 * build XML by hand or bake in a sign convention — amounts here are always
 * plain positive magnitudes and the serializer decides the polarity.
 */

export const TALLY_SCHEMA_VERSION = 1;

export type JobType = "master_ledger" | "master_stockitem" | "voucher";

export type JobStatus = "pending" | "in_progress" | "success" | "failed";

export interface VoucherLineItem {
  stockItemName: string;
  quantity: number;
  unit: string;
  rate: number;
  /** Positive magnitude. The serializer emits it as a debit (negative). */
  amount: number;
  purchaseLedger: string;
}

export interface VoucherTaxLine {
  ledgerName: string;
  /** Positive magnitude. The serializer emits it as a debit (negative). */
  amount: number;
}

export interface VoucherParty {
  ledgerName: string;
  gstin?: string | null;
  gstRegistrationType?: string | null;
}

export interface VoucherJob {
  guid: string;
  voucherType: "Purchase";
  /** ISO date, YYYY-MM-DD. Converted to Tally's YYYYMMDD by the serializer. */
  date: string;
  voucherNumber: string;
  /** Supplier's own bill number, used for bill-wise tracking. */
  reference: string;
  party: VoucherParty;
  narration?: string;
  lineItems: VoucherLineItem[];
  taxLines: VoucherTaxLine[];
  /**
   * Ledger that absorbs the non-tax portion when there are no line items
   * (an accounting-only invoice). Ignored when `lineItems` is non-empty.
   */
  accountingLedger?: string;
  /** Must equal sum(lineItems.amount) + sum(taxLines.amount). */
  totalAmount: number;
  /** GUIDs of master jobs that must reach `success` before this is pushed. */
  dependsOnMasterGuids?: string[];
}

export interface MasterLedgerJob {
  guid: string;
  masterType: "ledger";
  name: string;
  parentGroup: string;
  gstin?: string | null;
  gstRegistrationType?: string | null;
  billWiseOn?: boolean;
  /** Set for GST duty ledgers, e.g. "GST". */
  taxType?: string | null;
  /** e.g. "Central Tax" / "State Tax". */
  gstDutyHead?: string | null;
  gstApplicable?: boolean;
}

export interface MasterStockItemJob {
  guid: string;
  masterType: "stockItem";
  name: string;
  parentGroup: string;
  unit: string;
  gstApplicable?: boolean;
  hsnCode?: string | null;
  taxability?: string | null;
  cgstRate?: number | null;
  sgstRate?: number | null;
}

export type MasterJob = MasterLedgerJob | MasterStockItemJob;

export type JobPayload = VoucherJob | MasterJob;

export interface SyncJob {
  id: string;
  jobType: JobType;
  payload: JobPayload;
  tallyGuid: string;
  status: JobStatus;
  attempts: number;
  lastError?: string | null;
  schemaVersion: number;
  dependsOnGuids: string[];
}

/** Raised when a job's data cannot produce valid Tally XML. Never retryable. */
export class TallyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TallyValidationError";
  }
}

/**
 * Raised when a master's identity is ambiguous: close to something Tally
 * already holds, but not close enough to merge or split automatically.
 *
 * Distinct from TallyValidationError because the data is not wrong — it is
 * undecided. The bill parks until a human answers via resolve-item-match, and
 * `candidates` is what the review UI shows them.
 */
export class TallyReviewRequired extends Error {
  readonly itemType: "vendor" | "stock_item";
  readonly rawName: string;
  readonly candidates: string[];

  constructor(
    message: string,
    details: { itemType: "vendor" | "stock_item"; rawName: string; candidates: string[] },
  ) {
    super(message);
    this.name = "TallyReviewRequired";
    this.itemType = details.itemType;
    this.rawName = details.rawName;
    this.candidates = details.candidates;
  }
}


export function isVoucherJob(payload: JobPayload): payload is VoucherJob {
  return (payload as VoucherJob).voucherType !== undefined;
}

export function isLedgerMaster(payload: JobPayload): payload is MasterLedgerJob {
  return (payload as MasterLedgerJob).masterType === "ledger";
}

export function isStockItemMaster(payload: JobPayload): payload is MasterStockItemJob {
  return (payload as MasterStockItemJob).masterType === "stockItem";
}
