/**
 * Parsing Tally's HTTP-XML replies.
 *
 * Tally answers an import with HTTP 200 even when it rejected every voucher in
 * the payload, so the status code alone is never enough — the counters and
 * LINEERROR inside the body are what actually decide success.
 */

export interface TallyImportResult {
  created: number;
  altered: number;
  ignored: number;
  errors: number;
  /** Human-readable failure reason, or null when the import succeeded. */
  error: string | null;
  /** False when the failure is a logic/data problem that retrying won't fix. */
  retryable: boolean;
  raw: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function readCounter(body: string, tag: string): number {
  const match = body.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`, "i"));
  return match ? Number(match[1]) : 0;
}

export function extractLineError(responseText: string): string | null {
  const match = responseText.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i);
  return match ? decodeEntities(match[1]) : null;
}

/**
 * A master that already exists isn't a failure — the agent creates masters
 * defensively, so "already exists" means the precondition is satisfied.
 */
export function isAlreadyExistsError(message: string | null): boolean {
  return !!message && /already exists|exists already|name already exists|duplicate name/i.test(message);
}

/**
 * Errors that will never succeed on retry: bad ledger name, unbalanced
 * voucher, unknown stock item. These need a human, not a retry loop.
 */
export function isPermanentError(message: string | null): boolean {
  if (!message) return false;
  return /does not exist|could not (be )?find|unknown|mismatch in total|no such|invalid|not a valid|balance/i.test(
    message,
  );
}

export function parseTallyResponse(responseText: string, httpStatus: number): TallyImportResult {
  const raw = responseText ?? "";
  const created = readCounter(raw, "CREATED");
  const altered = readCounter(raw, "ALTERED");
  const ignored = readCounter(raw, "IGNORED");
  const errorCount = readCounter(raw, "ERRORS") + readCounter(raw, "EXCEPTIONS");
  const lineError = extractLineError(raw);

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      created,
      altered,
      ignored,
      errors: errorCount || 1,
      error: lineError || `Tally returned HTTP ${httpStatus}`,
      // A non-2xx from Tally is nearly always "busy" or "company not loaded".
      retryable: !isPermanentError(lineError),
      raw,
    };
  }

  if (lineError && isAlreadyExistsError(lineError)) {
    return { created, altered, ignored, errors: 0, error: null, retryable: false, raw };
  }

  if (lineError || errorCount > 0) {
    const message = lineError || `Tally reported ${errorCount} error(s)`;
    return {
      created,
      altered,
      ignored,
      errors: errorCount || 1,
      error: message,
      retryable: !isPermanentError(message),
      raw,
    };
  }

  if (created === 0 && altered === 0) {
    // No counters and no error usually means Tally never saw a company loaded.
    return {
      created,
      altered,
      ignored,
      errors: 0,
      error: "Tally accepted the request but created nothing (is the correct company loaded?)",
      retryable: true,
      raw,
    };
  }

  return { created, altered, ignored, errors: 0, error: null, retryable: false, raw };
}

export type MasterCollection = "Ledger" | "StockItem";

/**
 * Builds a master-listing request.
 *
 * Note this is a TDL Collection, not an `Export Data` + REPORTNAME request —
 * Tally answers the latter with "Could not find Report 'List of Ledgers'".
 * The FETCH element is what makes it return names rather than just counts.
 */
export function buildExportRequest(collectionType: MasterCollection, companyName: string): string {
  const company = companyName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const id = `Reconza${collectionType}List`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${id}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${id}" ISMODIFY="No" ISINITIALIZE="Yes">
            <TYPE>${collectionType}</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <FETCH>Name</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/** Pulls master names out of an export response, for existence checks. */
export function extractMasterNames(responseText: string): string[] {
  const names = new Set<string>();
  for (const match of responseText.matchAll(/<(?:NAME|LEDGERNAME|STOCKITEMNAME)>([\s\S]*?)<\/(?:NAME|LEDGERNAME|STOCKITEMNAME)>/gi)) {
    const name = decodeEntities(match[1]);
    if (name) names.add(name);
  }
  for (const match of responseText.matchAll(/\bNAME="([^"]+)"/gi)) {
    const name = decodeEntities(match[1]);
    if (name) names.add(name);
  }
  return [...names];
}
