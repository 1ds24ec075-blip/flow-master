/**
 * Talking to Tally. XML is rendered here, at send time, by the shared
 * serializer — nothing is written to disk on the way.
 */

import {
  buildExportRequest,
  extractMasterNames,
  parseTallyResponse,
  type MasterCollection,
  type TallyImportResult,
} from "../../supabase/functions/_shared/tally/response.ts";
import { serializeJobToXML, serializeStockGroupToXML, serializeUnitToXML } from "../../supabase/functions/_shared/tally/serializer.ts";
import { TallyValidationError, type JobPayload } from "../../supabase/functions/_shared/tally/types.ts";
import { log } from "./logger.ts";

const REQUEST_TIMEOUT_MS = 60_000;

export async function postXml(tallyUrl: string, xml: string): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(tallyUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: controller.signal,
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders and delivers one job.
 *
 * A serializer rejection is returned as a permanent failure rather than thrown:
 * an unbalanced voucher will never balance on retry, and the reason needs to
 * reach the dashboard.
 */
export async function pushJob(
  tallyUrl: string,
  payload: JobPayload,
  companyName: string,
): Promise<TallyImportResult> {
  let xml: string;
  try {
    xml = serializeJobToXML(payload, companyName);
  } catch (error) {
    if (error instanceof TallyValidationError) {
      return {
        created: 0,
        altered: 0,
        ignored: 0,
        errors: 1,
        error: error.message,
        retryable: false,
        raw: "",
      };
    }
    throw error;
  }

  const { status, body } = await postXml(tallyUrl, xml);
  const result = parseTallyResponse(body, status);

  if (result.error) log.warn("Tally rejected a job", { error: result.error, retryable: result.retryable });
  return result;
}

/** Unit and stock group must exist before any stock item can reference them. */
export async function ensureStockPrerequisites(
  tallyUrl: string,
  companyName: string,
  unit: string,
  stockGroup: string,
): Promise<void> {
  for (const xml of [serializeUnitToXML(unit, companyName), serializeStockGroupToXML(stockGroup, companyName)]) {
    const { status, body } = await postXml(tallyUrl, xml);
    const result = parseTallyResponse(body, status);
    // "already exists" is exactly what we want here, and parseTallyResponse
    // already reports that as success.
    if (result.error) log.debug("Stock prerequisite not created", result.error);
  }
}

/**
 * Reads back the names Tally already knows, so we can skip create jobs for
 * masters that exist (Tally rejects duplicate creates).
 */
export async function fetchExistingMasterNames(
  tallyUrl: string,
  companyName: string,
  collectionType: MasterCollection,
): Promise<Set<string>> {
  try {
    const { body } = await postXml(tallyUrl, buildExportRequest(collectionType, companyName));
    return new Set(extractMasterNames(body).map((name) => name.toLowerCase()));
  } catch (error) {
    log.debug(`Could not list ${collectionType} masters`, error instanceof Error ? error.message : error);
    return new Set();
  }
}

/**
 * Confirms the configured company is the one Tally has open.
 *
 * Tally doesn't report this directly — asking for a company it hasn't loaded
 * returns HTTP 200 with an empty collection and no error. Since every Tally
 * company ships with default ledgers (Cash, Profit & Loss A/c), zero ledgers
 * back means the name doesn't match what's open. Worth one request per cycle:
 * a mismatch here silently breaks every push that follows.
 */
export async function verifyCompanyLoaded(tallyUrl: string, companyName: string): Promise<string | null> {
  try {
    const { body } = await postXml(tallyUrl, buildExportRequest("Ledger", companyName));
    if (extractMasterNames(body).length > 0) return null;

    return `Tally did not return any ledgers for company "${companyName}". Check that this company is open in Tally and that the name matches exactly — it is case-sensitive.`;
  } catch (error) {
    // A transport failure is the process check's problem, not a name mismatch.
    log.debug("Company check could not reach Tally", error instanceof Error ? error.message : error);
    return null;
  }
}
