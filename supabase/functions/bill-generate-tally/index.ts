import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Bill = {
  id: string;
  bill_number: string | null;
  vendor_name: string | null;
  vendor_gst: string | null;
  bill_date: string | null;
  total_amount: number | null;
  payment_status: string | null;
  payment_method?: string | null;
  category_id: string | null;
  expense_categories?: { name: string | null } | null;
};

type ExpenseLineItem = {
  item_description: string | null;
  quantity: number | null;
  unit_price: number | null;
  tax_rate: number | null;
  amount: number | null;
};

type TallyLedgerDefinition = {
  name: string;
  parent: string;
  isBillWiseOn?: boolean;
  gstin?: string | null;
  gstApplicable?: boolean;
  taxType?: string;
  gstDutyHead?: string;
};

type TallyStockItemDefinition = {
  name: string;
  unit?: string;
  gstApplicable?: boolean;
};

const DEFAULT_STOCK_UNIT = "Nos";
const BILL_STOCK_GROUP_NAME = "Bill Items";
const INPUT_CGST_LEDGER_NAME = "Input CGST";
const INPUT_SGST_LEDGER_NAME = "Input SGST";
const TALLY_COMPANY_NAME = "Guhanesh";
const TALLY_FY_START = "20260401";
const TALLY_FY_END = "20270331";

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseTallyDate(dateValue: string | null): string | null {
  const rawDate = String(dateValue ?? "").trim();
  if (!rawDate) return null;

  const isoMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;

  const numericMatch = rawDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (numericMatch) {
    const [, day, month, year] = numericMatch;
    return `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`;
  }

  const textMatch = rawDate.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (textMatch) {
    const [, day, monthName, year] = textMatch;
    const monthIndex = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
      .findIndex((month) => monthName.toLowerCase().startsWith(month));
    if (monthIndex >= 0) return `${year}${String(monthIndex + 1).padStart(2, "0")}${day.padStart(2, "0")}`;
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeAmount(value: number | null | undefined): number {
  return Number(Number(value ?? 0).toFixed(2));
}

function getStockItemName(item: ExpenseLineItem, index: number): string {
  return (item.item_description || `Bill Item ${index + 1}`).trim();
}

function getItemQuantity(item: ExpenseLineItem): number {
  const quantity = normalizeAmount(item.quantity);
  return quantity > 0 ? quantity : 1;
}

function getItemAmount(item: ExpenseLineItem): number {
  return normalizeAmount(item.amount ?? item.unit_price ?? 0);
}

function getItemRate(item: ExpenseLineItem): number {
  const quantity = getItemQuantity(item);
  const amount = getItemAmount(item);
  const explicitRate = normalizeAmount(item.unit_price);
  return explicitRate > 0 ? explicitRate : normalizeAmount(amount / quantity);
}

function sumItemAmounts(items: ExpenseLineItem[]): number {
  return normalizeAmount(items.reduce((sum, item) => sum + getItemAmount(item), 0));
}

function buildVoucherGuid(bill: Bill): string {
  return `FLOW-BILL-${bill.id}`;
}

function assertDateInActiveFinancialYear(voucherDate: string) {
  if (voucherDate < TALLY_FY_START || voucherDate > TALLY_FY_END) {
    throw new Error("Bill date is outside the active Tally FY 2026-27. Use a date from 01 Apr 2026 to 31 Mar 2027.");
  }
}

function assertValidTallyVoucherXml(xml: string) {
  const xmlHeaderCount = (xml.match(/<\?xml\b/g) || []).length;
  if (xmlHeaderCount !== 1) throw new Error("Generated Tally XML must contain exactly one XML header");

  const voucherOpenMatches = [...xml.matchAll(/<VOUCHER\b[^>]*>/g)];
  const voucherCloseMatches = [...xml.matchAll(/<\/VOUCHER>/g)];
  if (voucherOpenMatches.length !== 1 || voucherCloseMatches.length !== 1) {
    throw new Error("Generated Tally XML must contain exactly one VOUCHER");
  }

  const voucherOpen = voucherOpenMatches[0];
  const voucherOpenEnd = (voucherOpen.index || 0) + voucherOpen[0].length;
  const voucherCloseStart = voucherCloseMatches[0].index || 0;
  if (voucherCloseStart <= voucherOpenEnd) throw new Error("Generated Tally XML has an invalid VOUCHER block");

  const voucherBody = xml.slice(voucherOpenEnd, voucherCloseStart);
  if (!/<DATE>\d{8}<\/DATE>/.test(voucherBody)) {
    throw new Error("Generated Tally XML is missing DATE directly inside VOUCHER");
  }
  if (!/<GUID>[^<]+<\/GUID>/.test(voucherBody)) {
    throw new Error("Generated Tally XML is missing a unique GUID inside VOUCHER");
  }
  if (!/<ISINVOICE>Yes<\/ISINVOICE>/.test(voucherBody)) {
    throw new Error("Generated Tally XML is missing ISINVOICE inside VOUCHER");
  }
  if (!/<PERSISTEDVIEW>Invoice Voucher View<\/PERSISTEDVIEW>/.test(voucherBody)) {
    throw new Error("Generated Tally XML is missing Invoice Voucher View inside VOUCHER");
  }
  if (/<(LEDGERNAME|STOCKITEMNAME|VOUCHERTYPENAME|PARTYLEDGERNAME)>\s*<\/\1>/.test(voucherBody)) {
    throw new Error("Generated Tally XML contains an empty required master field");
  }
}

function buildMasterMessages(
  ledgers: TallyLedgerDefinition[],
  stockItems: TallyStockItemDefinition[],
): string {
  const messages: string[] = [];
  const seenLedgers = new Set<string>();
  const seenStock = new Set<string>();

  if (stockItems.length > 0) {
    messages.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <UNIT NAME="${escapeXml(DEFAULT_STOCK_UNIT)}" ACTION="Create">
            <NAME>${escapeXml(DEFAULT_STOCK_UNIT)}</NAME>
            <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
            <SYMBOL>${escapeXml(DEFAULT_STOCK_UNIT)}</SYMBOL>
            <FORMALNAME>Numbers</FORMALNAME>
            <NUMBEROFDECIMALPLACES>0</NUMBEROFDECIMALPLACES>
          </UNIT>
        </TALLYMESSAGE>`);

    messages.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <STOCKGROUP NAME="${escapeXml(BILL_STOCK_GROUP_NAME)}" ACTION="Create">
            <NAME>${escapeXml(BILL_STOCK_GROUP_NAME)}</NAME>
            <ISADDABLE>Yes</ISADDABLE>
          </STOCKGROUP>
        </TALLYMESSAGE>`);
  }

  for (const ledger of ledgers) {
    const name = ledger.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenLedgers.has(key)) continue;
    seenLedgers.add(key);
    messages.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${escapeXml(name)}" ACTION="Create">
            <NAME>${escapeXml(name)}</NAME>
            <PARENT>${escapeXml(ledger.parent)}</PARENT>
            <ISBILLWISEON>${ledger.isBillWiseOn ? "Yes" : "No"}</ISBILLWISEON>
            <ISCOSTCENTRESON>No</ISCOSTCENTRESON>${ledger.gstApplicable ? "\n            <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>" : ""}${ledger.taxType ? `\n            <TAXTYPE>${escapeXml(ledger.taxType)}</TAXTYPE>` : ""}${ledger.gstDutyHead ? `\n            <GSTDUTYHEAD>${escapeXml(ledger.gstDutyHead)}</GSTDUTYHEAD>` : ""}${ledger.gstin ? `\n            <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>\n            <PARTYGSTIN>${escapeXml(ledger.gstin)}</PARTYGSTIN>` : ""}
          </LEDGER>
        </TALLYMESSAGE>`);
  }

  for (const item of stockItems) {
    const name = item.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenStock.has(key)) continue;
    seenStock.add(key);
    messages.push(`        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <STOCKITEM NAME="${escapeXml(name)}" ACTION="Create">
            <NAME>${escapeXml(name)}</NAME>
            <PARENT>${escapeXml(BILL_STOCK_GROUP_NAME)}</PARENT>
            <BASEUNITS>${escapeXml(item.unit || DEFAULT_STOCK_UNIT)}</BASEUNITS>${item.gstApplicable ? "\n            <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>\n            <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>" : ""}
          </STOCKITEM>
        </TALLYMESSAGE>`);
  }

  return messages.join("\n");
}

function inferPurchaseLedger(bill: Bill): string {
  const categoryName = bill.expense_categories?.name?.trim();
  if (!categoryName) return "Purchase Account";

  const normalized = categoryName.toLowerCase();
  if (normalized.includes("travel") || normalized.includes("transport")) return "Travelling Expenses";
  if (normalized.includes("utilities") || normalized.includes("electric")) return "Electricity Charges";
  if (normalized.includes("professional")) return "Professional Fees";
  if (normalized.includes("office")) return "Office Expenses";
  if (normalized.includes("maintenance") || normalized.includes("repair")) return "Repairs & Maintenance";
  if (normalized.includes("marketing") || normalized.includes("advertising")) return "Advertisement Expenses";

  return categoryName;
}

function generateTallyLedgerXML(ledger: TallyLedgerDefinition): string {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="${escapeXml(ledger.name)}" ACTION="Create">
            <NAME>${escapeXml(ledger.name)}</NAME>
            <PARENT>${escapeXml(ledger.parent)}</PARENT>
            <ISBILLWISEON>${ledger.isBillWiseOn ? "Yes" : "No"}</ISBILLWISEON>
            <ISCOSTCENTRESON>No</ISCOSTCENTRESON>
            ${ledger.gstApplicable ? "<GSTAPPLICABLE>Applicable</GSTAPPLICABLE>" : ""}
            ${ledger.taxType ? `<TAXTYPE>${escapeXml(ledger.taxType)}</TAXTYPE>` : ""}
            ${ledger.gstDutyHead ? `<GSTDUTYHEAD>${escapeXml(ledger.gstDutyHead)}</GSTDUTYHEAD>` : ""}
            ${ledger.gstin ? `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>${escapeXml(ledger.gstin)}</PARTYGSTIN>` : ""}
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  assertValidTallyVoucherXml(xml);
  return xml;
}

function generateTallyStockItemXML(item: TallyStockItemDefinition): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <STOCKITEM NAME="${escapeXml(item.name)}" ACTION="Create">
            <NAME>${escapeXml(item.name)}</NAME>
            <PARENT>${escapeXml(BILL_STOCK_GROUP_NAME)}</PARENT>
            <BASEUNITS>${escapeXml(item.unit || DEFAULT_STOCK_UNIT)}</BASEUNITS>
            ${item.gstApplicable ? "<GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>" : ""}
          </STOCKITEM>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function generateTallyStockGroupXML(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <STOCKGROUP NAME="${escapeXml(name)}" ACTION="Create">
            <NAME>${escapeXml(name)}</NAME>
            <ISADDABLE>Yes</ISADDABLE>
          </STOCKGROUP>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function generateTallyUnitXML(symbol: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <UNIT NAME="${escapeXml(symbol)}" ACTION="Create">
            <NAME>${escapeXml(symbol)}</NAME>
            <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
            <SYMBOL>${escapeXml(symbol)}</SYMBOL>
            <FORMALNAME>Numbers</FORMALNAME>
            <NUMBEROFDECIMALPLACES>0</NUMBEROFDECIMALPLACES>
          </UNIT>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function generateInventoryEntriesXML(items: ExpenseLineItem[], purchaseLedger: string): string {
  return items.map((item, index) => {
    const stockItemName = getStockItemName(item, index);
    const quantity = getItemQuantity(item);
    const rate = getItemRate(item);
    const amount = getItemAmount(item);

    return `            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>${escapeXml(stockItemName)}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <RATE>${rate}/${DEFAULT_STOCK_UNIT}</RATE>
              <AMOUNT>${amount}</AMOUNT>
              <ACTUALQTY>${quantity} ${DEFAULT_STOCK_UNIT}</ACTUALQTY>
              <BILLEDQTY>${quantity} ${DEFAULT_STOCK_UNIT}</BILLEDQTY>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>${escapeXml(purchaseLedger)}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
                <AMOUNT>${amount}</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>`;
  }).join("\n");
}

function generateTallyJSON(bill: Bill, items: ExpenseLineItem[]) {
  const totalAmount = normalizeAmount(bill.total_amount);
  const partyLedger = bill.vendor_name?.trim() || "Unknown Supplier";
  const purchaseLedger = inferPurchaseLedger(bill);

  return {
    source: "bills",
    source_id: bill.id,
    voucher_type: "Purchase",
    voucher_date: bill.bill_date,
    reference_number: bill.bill_number || `BILL-${bill.id.slice(0, 8)}`,
    party_ledger: partyLedger,
    purchase_ledger: purchaseLedger,
    vendor_gst: bill.vendor_gst,
    total_amount: totalAmount,
    line_items: items.map((item) => ({
      description: item.item_description || "Expense",
      quantity: normalizeAmount(item.quantity ?? 1),
      rate: normalizeAmount(item.unit_price),
      tax_rate: normalizeAmount(item.tax_rate),
      amount: normalizeAmount(item.amount),
    })),
    narration: `Bill ${bill.bill_number || bill.id.slice(0, 8)} from ${partyLedger}`,
  };
}

function generateTallyXML(bill: Bill, items: ExpenseLineItem[]): string {
  const payload = generateTallyJSON(bill, items);
  const totalAmount = payload.total_amount;
  const referenceNumber = payload.reference_number;
  const voucherDate = parseTallyDate(bill.bill_date);
  if (!voucherDate) throw new Error("Bill date is missing or invalid. Please edit the bill date before sending to Tally.");
  assertDateInActiveFinancialYear(voucherDate);
  const voucherGuid = buildVoucherGuid(bill);
  const narration = payload.narration;
  const purchaseLedger = payload.purchase_ledger;
  const partyLedger = payload.party_ledger;
  if (!partyLedger) throw new Error("Supplier ledger name is missing. Please edit the vendor before sending to Tally.");
  const validItems = items.filter((item, index) => getStockItemName(item, index) && getItemAmount(item) > 0);
  const inventoryTotal = sumItemAmounts(validItems);
  const gstTotal = normalizeAmount(totalAmount - inventoryTotal);
  if (gstTotal < 0) throw new Error("Bill line item total is greater than supplier total. Fix bill amounts before sending to Tally.");
  const cgstAmount = gstTotal > 0 ? normalizeAmount(gstTotal / 2) : 0;
  const sgstAmount = gstTotal > 0 ? normalizeAmount(gstTotal - cgstAmount) : 0;
  const balancedDebitTotal = normalizeAmount(inventoryTotal + cgstAmount + sgstAmount);
  if (Math.abs(normalizeAmount(balancedDebitTotal - totalAmount)) > 0.01) {
    throw new Error("Tally voucher is not balanced. Fix bill item/GST amounts before sending to Tally.");
  }
  const itemDetails = items.length > 0
    ? items.map((item) => `${item.item_description || "Expense"} (${normalizeAmount(item.amount)})`).join(", ")
    : "";
  const purchaseEntries = validItems.length > 0
    ? generateInventoryEntriesXML(validItems, purchaseLedger)
    : `            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(purchaseLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>No</ISPARTYLEDGER>
              <AMOUNT>${totalAmount}</AMOUNT>
            </LEDGERENTRIES.LIST>`;
  const gstEntries = gstTotal > 0
    ? `            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${INPUT_CGST_LEDGER_NAME}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>No</ISPARTYLEDGER>
              <AMOUNT>${cgstAmount}</AMOUNT>
            </LEDGERENTRIES.LIST>
            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${INPUT_SGST_LEDGER_NAME}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>No</ISPARTYLEDGER>
              <AMOUNT>${sgstAmount}</AMOUNT>
            </LEDGERENTRIES.LIST>`
    : "";

  const masterLedgers: TallyLedgerDefinition[] = [
    { name: purchaseLedger, parent: "Purchase Accounts", gstApplicable: true },
  ];
  if (gstTotal > 0) {
    masterLedgers.push({ name: INPUT_CGST_LEDGER_NAME, parent: "Duties & Taxes", taxType: "GST", gstDutyHead: "Central Tax" });
    masterLedgers.push({ name: INPUT_SGST_LEDGER_NAME, parent: "Duties & Taxes", taxType: "GST", gstDutyHead: "State Tax" });
  }
  masterLedgers.push({ name: partyLedger, parent: "Sundry Creditors", isBillWiseOn: true, gstin: bill.vendor_gst });

  const masterStockItems: TallyStockItemDefinition[] = validItems.map((item, index) => ({
    name: getStockItemName(item, index),
    unit: DEFAULT_STOCK_UNIT,
    gstApplicable: true,
  }));

  const masterMessages = buildMasterMessages(masterLedgers, masterStockItems);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(TALLY_COMPANY_NAME)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${masterMessages}
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${voucherDate}</DATE>
            <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
            <GUID>${escapeXml(voucherGuid)}</GUID>
            <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXml(referenceNumber)}</VOUCHERNUMBER>
            <REFERENCE>${escapeXml(referenceNumber)}</REFERENCE>
            <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
            <ISINVOICE>Yes</ISINVOICE>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <NARRATION>${escapeXml(itemDetails ? `${narration}. Items: ${itemDetails}` : narration)}</NARRATION>
${purchaseEntries}
${gstEntries ? `${gstEntries}\n` : ""}            <LEDGERENTRIES.LIST>
              <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>-${totalAmount}</AMOUNT>
              ${bill.vendor_gst ? `<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PARTYGSTIN>${escapeXml(bill.vendor_gst)}</PARTYGSTIN>` : ""}
            </LEDGERENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function postToTally(tallyUrl: string, tallyXML: string) {
  const response = await fetch(tallyUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: tallyXML,
  });

  const responseText = await response.text();
  const lineError = extractTallyLineError(responseText);
  if (!response.ok || lineError) {
    throw new Error(lineError || `Tally returned ${response.status}: ${responseText}`);
  }

  return responseText;
}

function extractTallyLineError(responseText: string): string | null {
  const match = responseText.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i);
  return match
    ? match[1]
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, "\"")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
    : null;
}

function isAlreadyExistsTallyError(message: string | null): boolean {
  return !!message && /already exists|exists already|name already exists/i.test(message);
}

async function ensureTallyLedgers(tallyUrl: string, ledgers: TallyLedgerDefinition[]) {
  const uniqueLedgers = Array.from(
    new Map(
      ledgers
        .filter((ledger) => ledger.name.trim())
        .map((ledger) => [ledger.name.trim().toLowerCase(), { ...ledger, name: ledger.name.trim() }])
    ).values()
  );

  for (const ledger of uniqueLedgers) {
    try {
      await postToTally(tallyUrl, generateTallyLedgerXML(ledger));
    } catch (error) {
      const message = error instanceof Error ? error.message : null;
      if (!isAlreadyExistsTallyError(message)) throw error;
    }
  }
}

async function ensureTallyStockItems(tallyUrl: string, items: TallyStockItemDefinition[]) {
  try {
    await postToTally(tallyUrl, generateTallyStockGroupXML(BILL_STOCK_GROUP_NAME));
  } catch (error) {
    const message = error instanceof Error ? error.message : null;
    if (!isAlreadyExistsTallyError(message)) throw error;
  }

  try {
    await postToTally(tallyUrl, generateTallyUnitXML(DEFAULT_STOCK_UNIT));
  } catch (error) {
    const message = error instanceof Error ? error.message : null;
    if (!isAlreadyExistsTallyError(message)) throw error;
  }

  const uniqueItems = Array.from(
    new Map(
      items
        .filter((item) => item.name.trim())
        .map((item) => [item.name.trim().toLowerCase(), { ...item, name: item.name.trim() }])
    ).values()
  );

  for (const item of uniqueItems) {
    try {
      await postToTally(tallyUrl, generateTallyStockItemXML(item));
    } catch (error) {
      const message = error instanceof Error ? error.message : null;
      if (!isAlreadyExistsTallyError(message)) throw error;
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { billId, sendToTally = false, tallyUrl } = await req.json();
    if (!billId) throw new Error("billId is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are missing");

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: bill, error: billError } = await supabase
      .from("bills")
      .select("*, expense_categories(name)")
      .eq("id", billId)
      .single();

    if (billError) throw billError;
    if (!bill) throw new Error("Bill not found");
    if (bill.is_duplicate) throw new Error("Duplicate bills cannot be sent to Tally");
    if (!bill.vendor_name || bill.vendor_name === "Processing...") throw new Error("Bill extraction is not complete");
    if (!bill.total_amount || Number(bill.total_amount) <= 0) throw new Error("Bill has no valid amount");

    const { data: lineItems, error: lineItemsError } = await supabase
      .from("expense_line_items")
      .select("item_description, quantity, unit_price, tax_rate, amount")
      .eq("bill_id", billId)
      .order("created_at", { ascending: true });

    if (lineItemsError) throw lineItemsError;

    const items = (lineItems || []) as ExpenseLineItem[];
    const tallyJSON = generateTallyJSON(bill as Bill, items);
    const tallyXML = generateTallyXML(bill as Bill, items);
    let tallyResponse: string | null = null;
    let nextStatus = "ready";
    let errorMessage: string | null = null;

    if (sendToTally) {
      const targetUrl = tallyUrl || Deno.env.get("TALLY_HTTP_URL");
      if (!targetUrl) throw new Error("TALLY_HTTP_URL is not configured");

      try {
        await ensureTallyLedgers(targetUrl, [
          { name: tallyJSON.purchase_ledger, parent: "Purchase Accounts", gstApplicable: true },
          { name: INPUT_CGST_LEDGER_NAME, parent: "Duties & Taxes", taxType: "GST", gstDutyHead: "Central Tax" },
          { name: INPUT_SGST_LEDGER_NAME, parent: "Duties & Taxes", taxType: "GST", gstDutyHead: "State Tax" },
          { name: tallyJSON.party_ledger, parent: "Sundry Creditors", isBillWiseOn: true, gstin: bill.vendor_gst },
        ]);
        await ensureTallyStockItems(
          items
            .filter((item, index) => getStockItemName(item, index) && getItemAmount(item) > 0)
            .map((item, index) => ({ name: getStockItemName(item, index), unit: DEFAULT_STOCK_UNIT, gstApplicable: true }))
        );
        tallyResponse = await postToTally(targetUrl, tallyXML);
        nextStatus = "sent";
      } catch (error) {
        nextStatus = "failed";
        errorMessage = error instanceof Error ? error.message : "Unknown Tally error";
      }
    }

    const { data: updatedBill, error: updateError } = await supabase
      .from("bills")
      .update({
        tally_json: tallyJSON,
        tally_xml: tallyXML,
        tally_status: nextStatus,
        tally_uploaded_at: nextStatus === "sent" ? new Date().toISOString() : null,
        tally_error: errorMessage,
      })
      .eq("id", billId)
      .select()
      .single();

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        bill: updatedBill,
        tally_json: tallyJSON,
        tally_xml: tallyXML,
        tally_status: nextStatus,
        tally_response: tallyResponse,
        tally_error: errorMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in bill-generate-tally:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
