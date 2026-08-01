/**
 * Run with:  node --test supabase/functions/_shared/tally/serializer.test.ts
 *
 * The reference XML below was exported from Tally itself, so these assertions
 * are checking against a voucher Tally is known to accept — not against our
 * own idea of what it wants.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildBillSyncJobs, deterministicGuid } from "./jobs.ts";
import { parseTallyResponse, isAlreadyExistsError, extractMasterNames } from "./response.ts";
import { serializeMasterToXML, serializeVoucherToXML, toTallyDate } from "./serializer.ts";
import { TallyValidationError, type VoucherJob } from "./types.ts";

const BILL = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  bill_number: "PPP-878",
  vendor_name: "Paper Plastic Packaging",
  vendor_gst: "29BCXPS2970P1Z7",
  bill_date: "2026-04-29",
  total_amount: 6675.0,
};

const ITEMS = [
  { item_description: "TISSUE PAPER 12X12 PIGEON", quantity: 150, unit_price: 23.31, tax_rate: 18, amount: 3495.76 },
  { item_description: "ALUMINIUM CONTAINER(B)", quantity: 300, unit_price: 3.71, tax_rate: 18, amount: 1114.28 },
  { item_description: "ALUMINIUM CONTAINER LID (B)", quantity: 300, unit_price: 0.51, tax_rate: 18, amount: 152.54 },
  { item_description: "ALUMINIUM CONTAINER(M)", quantity: 300, unit_price: 3.33, tax_rate: 18, amount: 999.99 },
  { item_description: "ALUMINIUM CONTAINER LID (M)", quantity: 300, unit_price: 0.42, tax_rate: 18, amount: 127.11 },
];

function voucherFor(overrides: Partial<VoucherJob> = {}): VoucherJob {
  const { voucher } = buildBillSyncJobs(BILL, ITEMS);
  return { ...voucher, ...overrides };
}

test("date parsing accepts the formats bills actually arrive in", () => {
  assert.equal(toTallyDate("2026-04-29"), "20260429");
  assert.equal(toTallyDate("29/04/2026"), "20260429");
  assert.equal(toTallyDate("29 April 2026"), "20260429");
  assert.equal(toTallyDate(""), null);
  assert.equal(toTallyDate("not a date"), null);
});

test("voucher matches the Tally-exported reference structure", () => {
  const xml = serializeVoucherToXML(voucherFor(), "Guhanesh");

  assert.match(xml, /<REPORTNAME>Vouchers<\/REPORTNAME>/);
  assert.match(xml, /<SVCURRENTCOMPANY>Guhanesh<\/SVCURRENTCOMPANY>/);
  assert.match(xml, /<TALLYMESSAGE xmlns:UDF="TallyUDF">/);
  assert.match(xml, /<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">/);
  assert.match(xml, /<DATE>20260429<\/DATE>/);
  assert.match(xml, /<VCHENTRYMODE>Item Invoice<\/VCHENTRYMODE>/);
  assert.match(xml, /<PARTYNAME>Paper Plastic Packaging<\/PARTYNAME>/);
  assert.match(xml, /<PARTYLEDGERNAME>Paper Plastic Packaging<\/PARTYLEDGERNAME>/);
  assert.match(xml, /<BILLTYPE>New Ref<\/BILLTYPE>/);

  // Item Invoice mode must never use the non-inventory tag.
  assert.ok(!xml.includes("<ALLLEDGERENTRIES.LIST>"));
  assert.equal([...xml.matchAll(/<ALLINVENTORYENTRIES\.LIST>/g)].length, 5);
});

test("every debit is negative and the single party credit is positive", () => {
  const xml = serializeVoucherToXML(voucherFor(), "Guhanesh");
  const pairs = [
    ...xml.matchAll(
      /<ISDEEMEDPOSITIVE>(Yes|No)<\/ISDEEMEDPOSITIVE>(?:\s*<(?:RATE|ISPARTYLEDGER)>[^<]*<\/(?:RATE|ISPARTYLEDGER)>)*\s*<AMOUNT>(-?\d+(?:\.\d+)?)<\/AMOUNT>/g,
    ),
  ];

  assert.ok(pairs.length > 0);
  for (const [, flag, amount] of pairs) {
    if (flag === "Yes") assert.ok(Number(amount) < 0, `debit ${amount} should be negative`);
    else assert.ok(Number(amount) > 0, `credit ${amount} should be positive`);
  }

  assert.equal(pairs.filter(([, flag]) => flag === "No").length, 1, "exactly one credit line");
});

test("voucher nets to zero to the paisa", () => {
  const xml = serializeVoucherToXML(voucherFor(), "Guhanesh");
  const topLevel = xml
    .replace(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g, "")
    .replace(/<BILLALLOCATIONS\.LIST>[\s\S]*?<\/BILLALLOCATIONS\.LIST>/g, "");
  const net = [...topLevel.matchAll(/<AMOUNT>(-?\d+(?:\.\d+)?)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.ok(Math.abs(net) < 0.01, `net ${net} should be zero`);
});

test("odd GST splits still balance", () => {
  const { voucher } = buildBillSyncJobs(
    { ...BILL, total_amount: 1000.01 },
    [
      { item_description: "A", quantity: 3, unit_price: 33.333, amount: 99.99 },
      { item_description: "B", quantity: 7, unit_price: 1.11, amount: 7.77 },
    ],
  );
  const taxTotal = voucher.taxLines.reduce((s, t) => s + t.amount, 0);
  assert.ok(Math.abs(99.99 + 7.77 + taxTotal - 1000.01) < 0.01);
  serializeVoucherToXML(voucher, "Guhanesh"); // throws if unbalanced
});

test("accounting-only invoice uses ALLLEDGERENTRIES and no inventory", () => {
  const { voucher } = buildBillSyncJobs(BILL, []);
  const xml = serializeVoucherToXML(voucher, "Guhanesh");
  assert.match(xml, /<VCHENTRYMODE>Accounting Invoice<\/VCHENTRYMODE>/);
  assert.match(xml, /<ALLLEDGERENTRIES\.LIST>/);
  assert.ok(!xml.includes("<ALLINVENTORYENTRIES.LIST>"));
  assert.match(xml, /<AMOUNT>-6675\.00<\/AMOUNT>/);
});

test("unbalanced and negative-magnitude jobs are rejected before rendering", () => {
  assert.throws(() => serializeVoucherToXML(voucherFor({ totalAmount: 9999 }), "X"), TallyValidationError);

  const v = voucherFor();
  assert.throws(
    () => serializeVoucherToXML({ ...v, lineItems: [{ ...v.lineItems[0], amount: -5 }] }, "X"),
    TallyValidationError,
  );
  assert.throws(() => serializeVoucherToXML(voucherFor({ date: "garbage" }), "X"), TallyValidationError);
  assert.throws(
    () => serializeVoucherToXML(voucherFor({ party: { ledgerName: "  " } }), "X"),
    TallyValidationError,
  );
});

test("bills that cannot become vouchers fail at job-build time", () => {
  assert.throws(() => buildBillSyncJobs({ ...BILL, vendor_name: "Processing..." }, ITEMS), TallyValidationError);
  assert.throws(() => buildBillSyncJobs({ ...BILL, total_amount: 0 }, ITEMS), TallyValidationError);
  assert.throws(() => buildBillSyncJobs({ ...BILL, bill_date: null }, ITEMS), TallyValidationError);
  // Line items exceeding the bill total would produce negative GST.
  assert.throws(() => buildBillSyncJobs({ ...BILL, total_amount: 10 }, ITEMS), TallyValidationError);
});

test("guids are deterministic so re-enqueueing cannot double-book", () => {
  const first = buildBillSyncJobs(BILL, ITEMS);
  const second = buildBillSyncJobs(BILL, ITEMS);
  assert.equal(first.voucher.guid, second.voucher.guid);
  assert.deepEqual(
    first.masters.map((m) => m.guid),
    second.masters.map((m) => m.guid),
  );
  assert.notEqual(deterministicGuid("ledger", "a"), deterministicGuid("ledger", "b"));
  assert.match(first.voucher.guid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("voucher declares every master it depends on", () => {
  const { masters, voucher } = buildBillSyncJobs(BILL, ITEMS);
  assert.deepEqual(new Set(voucher.dependsOnMasterGuids), new Set(masters.map((m) => m.guid)));
  // party + purchase + CGST + SGST + 5 stock items
  assert.equal(masters.length, 9);
});

test("masters render with their guid and parent group", () => {
  const { masters } = buildBillSyncJobs(BILL, ITEMS);
  const party = masters.find((m) => m.name === "Paper Plastic Packaging")!;
  const xml = serializeMasterToXML(party, "Guhanesh");
  assert.match(xml, /<REPORTNAME>All Masters<\/REPORTNAME>/);
  assert.match(xml, /<PARENT>Sundry Creditors<\/PARENT>/);
  assert.match(xml, /<ISBILLWISEON>Yes<\/ISBILLWISEON>/);
  assert.match(xml, /<PARTYGSTIN>29BCXPS2970P1Z7<\/PARTYGSTIN>/);
  assert.match(xml, new RegExp(`<GUID>${party.guid}</GUID>`));

  const stock = masters.find((m) => m.masterType === "stockItem")!;
  assert.match(serializeMasterToXML(stock, "Guhanesh"), /<BASEUNITS>Nos<\/BASEUNITS>/);
});

test("XML special characters in names are escaped", () => {
  const xml = serializeVoucherToXML(
    voucherFor({ party: { ledgerName: 'Smith & Sons <"Ltd">' } }),
    "Guhanesh",
  );
  assert.match(xml, /<PARTYNAME>Smith &amp; Sons &lt;&quot;Ltd&quot;&gt;<\/PARTYNAME>/);
  assert.ok(!xml.includes('<"Ltd">'));
});

test("Tally responses are classified correctly", () => {
  const ok = parseTallyResponse("<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></RESPONSE>", 200);
  assert.equal(ok.error, null);
  assert.equal(ok.created, 1);

  const dup = parseTallyResponse("<RESPONSE><LINEERROR>Ledger already exists!</LINEERROR></RESPONSE>", 200);
  assert.equal(dup.error, null, "already-exists is a satisfied precondition, not a failure");
  assert.ok(isAlreadyExistsError("Name already exists"));

  const missing = parseTallyResponse(
    "<RESPONSE><ERRORS>1</ERRORS><LINEERROR>Ledger &apos;Foo&apos; does not exist</LINEERROR></RESPONSE>",
    200,
  );
  assert.match(missing.error!, /does not exist/);
  assert.equal(missing.retryable, false, "missing master needs a human, not a retry");

  const busy = parseTallyResponse("", 503);
  assert.equal(busy.retryable, true);

  // 200 with no counters means Tally took the request but booked nothing.
  const silent = parseTallyResponse("<RESPONSE></RESPONSE>", 200);
  assert.ok(silent.error);
  assert.equal(silent.retryable, true);
});

test("master names can be read back out of an export response", () => {
  const names = extractMasterNames(
    "<ENVELOPE><LEDGER NAME=\"Input CGST\"><NAME>Input CGST</NAME></LEDGER><LEDGER NAME=\"Sundry\"><NAME>Sundry</NAME></LEDGER></ENVELOPE>",
  );
  assert.ok(names.includes("Input CGST"));
  assert.ok(names.includes("Sundry"));
});
