/**
 * THE serializer. Every byte of Tally XML this system produces comes from here.
 *
 * If you are about to write a template literal containing <ENVELOPE> anywhere
 * else in this repo, stop — add it to this module instead. The duplicated
 * generators that used to live in Bills.tsx, bill-generate-tally and
 * po-generate-tally drifted apart and produced three different sign
 * conventions and two different tag names for the same voucher.
 *
 * Runtime-neutral on purpose: no Deno, Node or DOM APIs, so the Supabase edge
 * functions, the local agent and the web app all import this same file.
 */

import {
  type JobPayload,
  type MasterJob,
  type MasterLedgerJob,
  type MasterStockItemJob,
  type VoucherJob,
  TallyValidationError,
  isLedgerMaster,
  isStockItemMaster,
  isVoucherJob,
} from "./types.ts";

/** Tolerance for the debit/credit balance check, in rupees. */
const BALANCE_TOLERANCE = 0.01;

export function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function round2(value: number): number {
  return Number(Number(value ?? 0).toFixed(2));
}

/** Always renders a positive magnitude; polarity is applied by the caller. */
function magnitude(value: number): string {
  return Math.abs(round2(value)).toFixed(2);
}

/** ISO (YYYY-MM-DD) or common Indian formats -> Tally's YYYYMMDD. */
export function toTallyDate(dateValue: string | null | undefined): string | null {
  const raw = String(dateValue ?? "").trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;

  const numericMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (numericMatch) {
    const [, day, month, year] = numericMatch;
    return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
  }

  const textMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (textMatch) {
    const [, day, monthName, year] = textMatch;
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .findIndex((month) => monthName.toLowerCase().startsWith(month));
    if (monthIndex >= 0) return `${year}${String(monthIndex + 1).padStart(2, "0")}${day.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function envelope(reportName: "Vouchers" | "All Masters", companyName: string, messages: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${reportName}</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

// ---------------------------------------------------------------------------
// Validation — runs BEFORE any XML is produced so a bad job fails fast with a
// human-readable reason instead of being posted to Tally and bouncing.
// ---------------------------------------------------------------------------

export function validateVoucher(voucher: VoucherJob): void {
  if (!voucher.guid) throw new TallyValidationError("Voucher is missing a guid");
  if (!voucher.party?.ledgerName?.trim()) {
    throw new TallyValidationError("Voucher is missing a party ledger name");
  }
  if (!voucher.voucherNumber?.trim()) {
    throw new TallyValidationError("Voucher is missing a voucher number");
  }
  if (!toTallyDate(voucher.date)) {
    throw new TallyValidationError(`Voucher date "${voucher.date}" is missing or unparseable`);
  }

  const lineItems = voucher.lineItems ?? [];
  const taxLines = voucher.taxLines ?? [];

  for (const item of lineItems) {
    if (!item.stockItemName?.trim()) {
      throw new TallyValidationError("A line item is missing its stock item name");
    }
    if (!item.purchaseLedger?.trim()) {
      throw new TallyValidationError(`Line item "${item.stockItemName}" is missing its purchase ledger`);
    }
    if (!(item.amount > 0)) {
      throw new TallyValidationError(`Line item "${item.stockItemName}" must have a positive amount`);
    }
    if (item.amount < 0 || item.rate < 0 || item.quantity < 0) {
      throw new TallyValidationError(
        `Line item "${item.stockItemName}" has a negative quantity/rate/amount; the serializer owns sign convention, pass magnitudes`,
      );
    }
  }

  for (const tax of taxLines) {
    if (!tax.ledgerName?.trim()) throw new TallyValidationError("A tax line is missing its ledger name");
    if (tax.amount < 0) {
      throw new TallyValidationError(
        `Tax line "${tax.ledgerName}" has a negative amount; the serializer owns sign convention, pass magnitudes`,
      );
    }
  }

  const itemTotal = round2(lineItems.reduce((sum, item) => sum + round2(item.amount), 0));
  const taxTotal = round2(taxLines.reduce((sum, tax) => sum + round2(tax.amount), 0));
  const creditTotal = round2(voucher.totalAmount);

  if (!(creditTotal > 0)) {
    throw new TallyValidationError("Voucher totalAmount must be greater than zero");
  }

  if (lineItems.length === 0) {
    // Accounting-only invoice: the accounting ledger absorbs whatever the tax
    // lines don't, so the only way this can't balance is taxes exceeding total.
    if (round2(taxTotal - creditTotal) > BALANCE_TOLERANCE) {
      throw new TallyValidationError(
        `Voucher tax lines (${taxTotal.toFixed(2)}) exceed the party total (${creditTotal.toFixed(2)})`,
      );
    }
    return;
  }

  const debitTotal = round2(itemTotal + taxTotal);
  if (Math.abs(round2(debitTotal - creditTotal)) > BALANCE_TOLERANCE) {
    throw new TallyValidationError(
      `Voucher does not balance: line items (${itemTotal.toFixed(2)}) + taxes (${taxTotal.toFixed(2)}) = ${debitTotal.toFixed(2)}, party total = ${creditTotal.toFixed(2)}`,
    );
  }
}

export function validateMaster(master: MasterJob): void {
  if (!master.guid) throw new TallyValidationError("Master is missing a guid");
  if (!master.name?.trim()) throw new TallyValidationError("Master is missing a name");
  if (!master.parentGroup?.trim()) {
    throw new TallyValidationError(`Master "${master.name}" is missing a parent group`);
  }
  if (isStockItemMaster(master) && !master.unit?.trim()) {
    throw new TallyValidationError(`Stock item "${master.name}" is missing a unit`);
  }
}

// ---------------------------------------------------------------------------
// Voucher serialization
// ---------------------------------------------------------------------------

function inventoryEntries(voucher: VoucherJob): string {
  return voucher.lineItems
    .map(
      (item) => `            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>${escapeXml(item.stockItemName)}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <RATE>${magnitude(item.rate)}/${escapeXml(item.unit)}</RATE>
              <AMOUNT>-${magnitude(item.amount)}</AMOUNT>
              <ACTUALQTY>${round2(item.quantity)} ${escapeXml(item.unit)}</ACTUALQTY>
              <BILLEDQTY>${round2(item.quantity)} ${escapeXml(item.unit)}</BILLEDQTY>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>${escapeXml(item.purchaseLedger)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
                <AMOUNT>-${magnitude(item.amount)}</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>`,
    )
    .join("\n");
}

/**
 * Renders a purchase voucher.
 *
 * Sign convention, applied here and nowhere else: every debit line (stock
 * items, purchase ledger, input taxes) is ISDEEMEDPOSITIVE=Yes with a NEGATIVE
 * amount; the single credit line (the party) is ISDEEMEDPOSITIVE=No with a
 * POSITIVE amount. Summing to zero is not sufficient — Tally rejects the
 * voucher if the sign disagrees with the flag on any individual line.
 */
export function serializeVoucherToXML(voucher: VoucherJob, companyName: string): string {
  validateVoucher(voucher);

  const voucherDate = toTallyDate(voucher.date)!;
  const partyLedger = voucher.party.ledgerName.trim();
  const hasInventory = (voucher.lineItems ?? []).length > 0;
  // LEDGERENTRIES.LIST is the Item Invoice tag. ALLLEDGERENTRIES.LIST is only
  // valid on non-inventory vouchers and causes a mismatch error in item mode.
  const entryTag = hasInventory ? "LEDGERENTRIES.LIST" : "ALLLEDGERENTRIES.LIST";

  const taxTotal = round2((voucher.taxLines ?? []).reduce((sum, tax) => sum + round2(tax.amount), 0));

  const debitEntries = hasInventory
    ? inventoryEntries(voucher)
    : `            <${entryTag}>
              <LEDGERNAME>${escapeXml(voucher.accountingLedger || "Purchase Account")}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${magnitude(round2(voucher.totalAmount) - taxTotal)}</AMOUNT>
            </${entryTag}>`;

  const taxEntries = (voucher.taxLines ?? [])
    .filter((tax) => round2(tax.amount) > 0)
    .map(
      (tax) => `            <${entryTag}>
              <LEDGERNAME>${escapeXml(tax.ledgerName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${magnitude(tax.amount)}</AMOUNT>
            </${entryTag}>`,
    )
    .join("\n");

  const message = `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${escapeXml(voucher.voucherType)}" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${voucherDate}</DATE>
            <GUID>${escapeXml(voucher.guid)}</GUID>
            <VOUCHERTYPENAME>${escapeXml(voucher.voucherType)}</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXml(voucher.voucherNumber)}</VOUCHERNUMBER>
            <PARTYNAME>${escapeXml(partyLedger)}</PARTYNAME>
            <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
            <REFERENCE>${escapeXml(voucher.reference || voucher.voucherNumber)}</REFERENCE>
            <NARRATION>${escapeXml(voucher.narration ?? "")}</NARRATION>
            <VCHENTRYMODE>${hasInventory ? "Item Invoice" : "Accounting Invoice"}</VCHENTRYMODE>
${debitEntries}
${taxEntries ? `${taxEntries}\n` : ""}            <${entryTag}>
              <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>${magnitude(voucher.totalAmount)}</AMOUNT>
              <BILLALLOCATIONS.LIST>
                <NAME>${escapeXml(voucher.reference || voucher.voucherNumber)}</NAME>
                <BILLTYPE>New Ref</BILLTYPE>
                <AMOUNT>${magnitude(voucher.totalAmount)}</AMOUNT>
              </BILLALLOCATIONS.LIST>
            </${entryTag}>
          </VOUCHER>
        </TALLYMESSAGE>`;

  const xml = envelope("Vouchers", companyName, message);
  assertRenderedVoucherIsSane(xml);
  return xml;
}

// ---------------------------------------------------------------------------
// Master serialization
// ---------------------------------------------------------------------------

function ledgerMessage(ledger: MasterLedgerJob): string {
  const optional = [
    ledger.gstApplicable ? "            <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>" : "",
    ledger.taxType ? `            <TAXTYPE>${escapeXml(ledger.taxType)}</TAXTYPE>` : "",
    ledger.gstDutyHead ? `            <GSTDUTYHEAD>${escapeXml(ledger.gstDutyHead)}</GSTDUTYHEAD>` : "",
    ledger.gstin
      ? `            <GSTREGISTRATIONTYPE>${escapeXml(ledger.gstRegistrationType || "Regular")}</GSTREGISTRATIONTYPE>\n            <PARTYGSTIN>${escapeXml(ledger.gstin)}</PARTYGSTIN>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${escapeXml(ledger.name)}" ACTION="Create">
            <NAME>${escapeXml(ledger.name)}</NAME>
            <GUID>${escapeXml(ledger.guid)}</GUID>
            <PARENT>${escapeXml(ledger.parentGroup)}</PARENT>
            <ISBILLWISEON>${ledger.billWiseOn ? "Yes" : "No"}</ISBILLWISEON>
            <ISCOSTCENTRESON>No</ISCOSTCENTRESON>${optional ? `\n${optional}` : ""}
          </LEDGER>
        </TALLYMESSAGE>`;
}

function stockItemMessage(item: MasterStockItemJob): string {
  const optional = [
    item.gstApplicable
      ? "            <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>\n            <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>"
      : "",
    item.hsnCode ? `            <HSNCODE>${escapeXml(item.hsnCode)}</HSNCODE>` : "",
    item.taxability ? `            <GSTTAXABILITY>${escapeXml(item.taxability)}</GSTTAXABILITY>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <STOCKITEM NAME="${escapeXml(item.name)}" ACTION="Create">
            <NAME>${escapeXml(item.name)}</NAME>
            <GUID>${escapeXml(item.guid)}</GUID>
            <PARENT>${escapeXml(item.parentGroup)}</PARENT>
            <BASEUNITS>${escapeXml(item.unit)}</BASEUNITS>${optional ? `\n${optional}` : ""}
          </STOCKITEM>
        </TALLYMESSAGE>`;
}

export function serializeMasterToXML(master: MasterJob, companyName: string): string {
  validateMaster(master);
  const message = isLedgerMaster(master) ? ledgerMessage(master) : stockItemMessage(master as MasterStockItemJob);
  return envelope("All Masters", companyName, message);
}

/** A unit master must exist before a stock item can reference it as BASEUNITS. */
export function serializeUnitToXML(symbol: string, companyName: string): string {
  const message = `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <UNIT NAME="${escapeXml(symbol)}" ACTION="Create">
            <NAME>${escapeXml(symbol)}</NAME>
            <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
            <SYMBOL>${escapeXml(symbol)}</SYMBOL>
            <FORMALNAME>${escapeXml(symbol)}</FORMALNAME>
            <NUMBEROFDECIMALPLACES>0</NUMBEROFDECIMALPLACES>
          </UNIT>
        </TALLYMESSAGE>`;
  return envelope("All Masters", companyName, message);
}

export function serializeStockGroupToXML(name: string, companyName: string): string {
  const message = `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <STOCKGROUP NAME="${escapeXml(name)}" ACTION="Create">
            <NAME>${escapeXml(name)}</NAME>
            <ISADDABLE>Yes</ISADDABLE>
          </STOCKGROUP>
        </TALLYMESSAGE>`;
  return envelope("All Masters", companyName, message);
}

/** Dispatches on job payload shape; used by the agent's queue processor. */
export function serializeJobToXML(payload: JobPayload, companyName: string): string {
  if (isVoucherJob(payload)) return serializeVoucherToXML(payload, companyName);
  return serializeMasterToXML(payload as MasterJob, companyName);
}

// ---------------------------------------------------------------------------
// Post-render self-check
//
// Belt-and-braces: re-reads the string we are about to put on the wire and
// re-derives the invariants from the XML itself, so a future edit to the
// template can't silently reintroduce an inverted sign or the wrong tag.
// ---------------------------------------------------------------------------

export function assertRenderedVoucherIsSane(xml: string): void {
  const voucherOpenMatches = [...xml.matchAll(/<VOUCHER\b[^>]*>/g)];
  const voucherCloseMatches = [...xml.matchAll(/<\/VOUCHER>/g)];
  if (voucherOpenMatches.length !== 1 || voucherCloseMatches.length !== 1) {
    throw new TallyValidationError("Rendered XML must contain exactly one VOUCHER");
  }

  const voucherOpen = voucherOpenMatches[0];
  const bodyStart = (voucherOpen.index ?? 0) + voucherOpen[0].length;
  const bodyEnd = voucherCloseMatches[0].index ?? 0;
  if (bodyEnd <= bodyStart) throw new TallyValidationError("Rendered XML has an invalid VOUCHER block");

  for (const attribute of ['ACTION="Create"', 'OBJVIEW="Invoice Voucher View"']) {
    if (!voucherOpen[0].includes(attribute)) {
      throw new TallyValidationError(`Rendered XML is missing ${attribute} on VOUCHER`);
    }
  }

  const body = xml.slice(bodyStart, bodyEnd);

  if (!/<DATE>\d{8}<\/DATE>/.test(body)) {
    throw new TallyValidationError("Rendered XML is missing DATE (YYYYMMDD) inside VOUCHER");
  }
  if (!/<GUID>[^<]+<\/GUID>/.test(body)) {
    throw new TallyValidationError("Rendered XML is missing GUID inside VOUCHER");
  }
  if (/<(LEDGERNAME|STOCKITEMNAME|VOUCHERTYPENAME|PARTYNAME|PARTYLEDGERNAME)>\s*<\/\1>/.test(body)) {
    throw new TallyValidationError("Rendered XML contains an empty required master field");
  }

  const partyName = body.match(/<PARTYNAME>([\s\S]*?)<\/PARTYNAME>/)?.[1];
  const partyLedgerName = body.match(/<PARTYLEDGERNAME>([\s\S]*?)<\/PARTYLEDGERNAME>/)?.[1];
  if (!partyName || !partyLedgerName) {
    throw new TallyValidationError("Rendered XML must contain both PARTYNAME and PARTYLEDGERNAME");
  }
  if (partyName !== partyLedgerName) {
    throw new TallyValidationError("PARTYNAME and PARTYLEDGERNAME must be identical");
  }

  if (body.includes("<ALLINVENTORYENTRIES.LIST>")) {
    if (!/<VCHENTRYMODE>Item Invoice<\/VCHENTRYMODE>/.test(body)) {
      throw new TallyValidationError("VCHENTRYMODE must be Item Invoice whenever ALLINVENTORYENTRIES.LIST is used");
    }
    if (body.includes("<ALLLEDGERENTRIES.LIST>")) {
      throw new TallyValidationError("Item Invoice vouchers must use LEDGERENTRIES.LIST, never ALLLEDGERENTRIES.LIST");
    }
  }

  // Sign must agree with the flag on every single line, not just net to zero.
  const signPattern =
    /<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>(?:\s*<(?:RATE|ISPARTYLEDGER)>[^<]*<\/(?:RATE|ISPARTYLEDGER)>)*\s*<AMOUNT>(-?\d+(?:\.\d+)?)<\/AMOUNT>/g;
  let signMatch: RegExpExecArray | null;
  while ((signMatch = signPattern.exec(body)) !== null) {
    const amount = Number(signMatch[2]);
    if (signMatch[1] === "Yes" && amount > 0) {
      throw new TallyValidationError("Debit entries (ISDEEMEDPOSITIVE=Yes) must carry a negative AMOUNT");
    }
    if (signMatch[1] === "No" && amount < 0) {
      throw new TallyValidationError("Credit entries (ISDEEMEDPOSITIVE=No) must carry a positive AMOUNT");
    }
  }

  // Nested allocations restate their parent's amount, so drop them before netting.
  const topLevel = body
    .replace(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g, "")
    .replace(/<BILLALLOCATIONS\.LIST>[\s\S]*?<\/BILLALLOCATIONS\.LIST>/g, "");
  const net = [...topLevel.matchAll(/<AMOUNT>(-?\d+(?:\.\d+)?)<\/AMOUNT>/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
  if (Math.abs(net) > BALANCE_TOLERANCE) {
    throw new TallyValidationError("Rendered voucher debit and credit entries do not net to zero");
  }
}
