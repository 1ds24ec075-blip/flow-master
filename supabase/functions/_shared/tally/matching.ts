/**
 * Master identity: deciding whether a bill's vendor or stock item is one Tally
 * already has, or a genuinely new one.
 *
 * Why this exists: a master's identity in Tally IS its name, and our GUIDs are
 * derived from that name. So "Paper Plastic Packaging" and "Paper Plastic
 * Packaging Pvt Ltd" produce different GUIDs, different masters, and a vendor
 * balance split across two ledgers that nobody notices until a statement is
 * reconciled. Same for "ALUMINIUM CONTAINER(B)" vs "ALUMINIUM CONTAINER (B)".
 *
 * The governing rule everywhere below: never guess. Auto-match only on evidence
 * strong enough to be near-certain (a shared GSTIN, or an identical name after
 * normalisation). Create only when the candidates are clearly unrelated.
 * Anything in between is handed to a human, because both wrong answers are
 * expensive and silent — a bad merge corrupts an existing balance, a bad split
 * fragments one.
 *
 * Runtime-neutral and dependency-free, like the serializer: this same file has
 * to run in an edge function, in the agent and in the browser.
 */

import { deterministicGuid } from "./guid.ts";

/** What to do with one master, and why. */
export type MasterMatch =
  /** Use this existing Tally master. `name` is the name Tally already knows. */
  | { kind: "matched"; name: string; reason: "gstin" | "exact-name" | "resolution" }
  /** No plausible existing master. Create it as today. */
  | { kind: "create" }
  /**
   * Close to something that exists, but not close enough to act on. The bill
   * stops here and a human decides; nothing is created and nothing is merged.
   */
  | { kind: "review"; message: string; candidates: string[] };

/** The Tally group vendor ledgers live under. */
export const VENDOR_LEDGER_GROUP = "Sundry Creditors";

/** A ledger this system has confirmed Tally holds. */
export interface KnownVendorLedger {
  /** Exactly as it exists in Tally. */
  name: string;
  /** As recorded when it was created; null for ledgers created before GSTINs were captured. */
  gstin: string | null;
}

/** A stock item this system has confirmed Tally holds. */
export interface KnownStockItem {
  name: string;
}

/**
 * A human's answer to one previously-ambiguous match, persisted so the same
 * question is never asked twice for the same exact string.
 *
 * Keyed on the *normalized* name (the same Tier-1 normalization the matchers
 * use), so trivial spacing/case/punctuation variants share one answer — that
 * is what makes a single decision cover future bills. A genuinely different
 * OCR read produces a different key and goes through matching afresh. The
 * answer is literal and independent per string: resolving "ALUMINIUM
 * CONTAINER M" says nothing about any other parenthetical suffix.
 *
 * Only judgment calls live here. Confident auto-matches are recomputed every
 * time and must never be persisted — these functions are pure and cannot
 * write, and the sole writer (resolve-item-match) is only reachable from the
 * review UI.
 */
export interface MatchResolution {
  /** Normalized with normalizeVendorName / normalizeStockItemName. */
  rawNameNormalized: string;
  itemType: "vendor" | "stock_item";
  resolution: "matched" | "distinct";
  /** Deterministic GUID of the chosen master; null when resolution is "distinct". */
  matchedToGuid: string | null;
}

/** Finds the stored human answer for one normalized name, if any. */
function resolutionFor(
  resolutions: MatchResolution[] | undefined,
  itemType: MatchResolution["itemType"],
  normalized: string,
): MatchResolution | undefined {
  return resolutions?.find(
    (entry) => entry.itemType === itemType && entry.rawNameNormalized === normalized,
  );
}

/** One delivered row of tally_sync_queue, as far as this module cares. */
export interface DeliveredMasterRow {
  job_type: string;
  payload_json: unknown;
}

/**
 * Reads the masters Tally is known to hold out of delivered queue rows.
 *
 * tally_sync_queue is the only honest record of this: a row reaches 'success'
 * either because Tally created the master or because the agent confirmed Tally
 * already had it. ledger_master would look like the natural home, but it has no
 * GSTIN column and nothing has read or written it since it was seeded.
 *
 * Only Sundry Creditors ledgers are returned as vendors. Without that filter
 * "Input CGST" and "Purchase Account" become candidate suppliers, and every
 * bill starts matching the tax ledgers.
 */
export function knownMastersFromDelivered(rows: DeliveredMasterRow[]): {
  vendors: KnownVendorLedger[];
  stockItems: KnownStockItem[];
} {
  const vendors: KnownVendorLedger[] = [];
  const stockItems: KnownStockItem[] = [];

  for (const row of rows ?? []) {
    const payload = row?.payload_json as
      | { name?: unknown; parentGroup?: unknown; gstin?: unknown }
      | null
      | undefined;
    const name = typeof payload?.name === "string" ? payload.name.trim() : "";
    if (!name) continue;

    if (row.job_type === "master_stockitem") {
      stockItems.push({ name });
      continue;
    }

    if (row.job_type === "master_ledger" && payload?.parentGroup === VENDOR_LEDGER_GROUP) {
      vendors.push({ name, gstin: typeof payload.gstin === "string" ? payload.gstin : null });
    }
  }

  return { vendors, stockItems };
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Trailing legal-form suffixes that carry no identity.
 *
 * Deliberately short. "Co", "Company" and "& Sons" are NOT here: they routinely
 * distinguish real, separate Indian businesses ("Sharma Traders" vs "Sharma
 * Traders Company" can genuinely be two firms), and over-stripping merges
 * ledgers, which is the more expensive mistake.
 */
const LEGAL_SUFFIXES = ["private", "pvt", "limited", "ltd", "llp"];

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Strips punctuation, collapses whitespace, lower-cases. */
function basicNormalize(raw: string): string {
  return collapse(
    String(raw ?? "")
      .toLowerCase()
      // Punctuation becomes a space rather than nothing, so "A.B" and "A B"
      // agree while "AB" stays distinct.
      .replace(/[.,/\\()\[\]{}'"`&+_-]/g, " "),
  );
}

/**
 * Vendor name reduced to its identifying part: punctuation and case dropped,
 * trailing legal suffixes removed.
 *
 * "Paper Plastic Packaging Pvt. Ltd." -> "paper plastic packaging"
 */
export function normalizeVendorName(raw: string): string {
  let normalized = basicNormalize(raw);

  // Repeatedly, because "Pvt Ltd" is two suffixes in a row.
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (normalized === suffix) break; // never reduce a name to nothing
      if (normalized.endsWith(` ${suffix}`)) {
        normalized = normalized.slice(0, -(suffix.length + 1)).trim();
        trimmed = true;
      }
    }
  }

  return normalized;
}

/**
 * Stock item name reduced for comparison: upper-cased, punctuation dropped,
 * whitespace collapsed.
 *
 * "ALUMINIUM CONTAINER(B)" -> "ALUMINIUM CONTAINER B"
 */
export function normalizeStockItemName(raw: string): string {
  return basicNormalize(raw).toUpperCase();
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/** Levenshtein edit distance, two-row variant so memory stays O(min(a,b)). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/**
 * The tokens in a name that decide *which* item it is, rather than what kind.
 *
 * Product names carry their variant in a short token: a size ("12X12"), a grade
 * ("(B)" vs "(M)"), a form ("LID"). Those differences are one or two characters
 * against a long shared prefix, so string similarity rates them ~0.95 —
 * indistinguishable from a typo, and merging them silently combines the stock
 * of two different products.
 *
 * A token counts as a discriminator when it is short (<= 3 characters) or
 * contains a digit. If the discriminators disagree, no amount of textual
 * similarity is allowed to auto-match.
 *
 * Sorted, so word order does not matter.
 */
export function discriminatorSignature(value: string): string {
  return (value.match(/\S+/g) ?? [])
    .filter((token) => token.length <= 3 || /\d/.test(token))
    .sort()
    .join(" ");
}

/** Above this, two names are treated as the same thing. */
const STOCK_AUTO_MATCH = 0.92;
/** Between this and the auto threshold, a human decides. */
const STOCK_REVIEW = 0.8;
/** Vendors are never auto-matched on similarity alone — only flagged. */
const VENDOR_REVIEW = 0.85;

interface Scored<T> {
  candidate: T;
  score: number;
}

function bestMatches<T>(candidates: T[], score: (candidate: T) => number, floor: number): Scored<T>[] {
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((scored) => scored.score >= floor)
    .sort((left, right) => right.score - left.score);
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * Resolves a bill's vendor against the ledgers Tally already has.
 *
 * GSTIN first, because it is the only identifier that is actually unique — a
 * GSTIN match settles the question no matter how differently the name was
 * typed or extracted. Names are the fallback, and only an exact match after
 * normalisation is acted on automatically.
 *
 * A candidate whose recorded GSTIN differs from this bill's is discarded
 * outright: same trading name, different registration, different legal entity.
 * Merging those would be the worst outcome available.
 */
export function matchVendorLedger(
  vendor: { name: string; gstin: string | null },
  known: KnownVendorLedger[],
  resolutions?: MatchResolution[],
): MasterMatch {
  const gstin = vendor.gstin?.trim().toUpperCase() || null;

  if (gstin) {
    const byGstin = known.find((candidate) => candidate.gstin?.trim().toUpperCase() === gstin);
    // Settled. The name on this bill is ignored entirely, which is the point.
    // This also outranks any stored resolution: a GSTIN is conclusive evidence,
    // a resolution is a judgment made when there was none.
    if (byGstin) return { kind: "matched", name: byGstin.name, reason: "gstin" };
  }

  // Anything registered under a different GSTIN is a different party.
  const plausible = known.filter((candidate) => {
    const candidateGstin = candidate.gstin?.trim().toUpperCase() || null;
    if (!candidateGstin || !gstin) return true;
    return candidateGstin === gstin;
  });

  const normalized = normalizeVendorName(vendor.name);
  if (!normalized) return { kind: "create" };

  // A human already answered this exact question — don't ask again.
  const resolved = resolutionFor(resolutions, "vendor", normalized);
  if (resolved) {
    if (resolved.resolution === "distinct") return { kind: "create" };
    const chosen = plausible.find(
      (candidate) => deterministicGuid("ledger", candidate.name.toLowerCase()) === resolved.matchedToGuid,
    );
    // The chosen master has to still exist among the delivered set; if it
    // vanished (queue reset, revoked agent) the stale answer is ignored and
    // matching runs as if it were never given.
    if (chosen) return { kind: "matched", name: chosen.name, reason: "resolution" };
  }

  const exact = plausible.filter((candidate) => normalizeVendorName(candidate.name) === normalized);
  if (exact.length === 1) {
    // Identical once punctuation and legal suffixes are gone, and nothing
    // contradicts it. Safe without asking.
    return { kind: "matched", name: exact[0].name, reason: "exact-name" };
  }
  if (exact.length > 1) {
    return {
      kind: "review",
      message: `"${vendor.name}" matches more than one existing ledger by name. Confirm which one this bill belongs to.`,
      candidates: exact.map((candidate) => candidate.name),
    };
  }

  const near = bestMatches(plausible, (candidate) => similarity(normalizeVendorName(candidate.name), normalized), VENDOR_REVIEW);
  if (near.length > 0) {
    return {
      kind: "review",
      message:
        `Possible duplicate vendor — confirm. "${vendor.name}" closely resembles ` +
        `${near.map((scored) => `"${scored.candidate.name}"`).join(", ")}, and there is no GSTIN to settle it.`,
      candidates: near.map((scored) => scored.candidate.name),
    };
  }

  return { kind: "create" };
}

// ---------------------------------------------------------------------------
// Stock items
// ---------------------------------------------------------------------------

/**
 * Resolves a line item against the stock items Tally already has.
 *
 * Stock items have no GSTIN-equivalent, so this is name-only and correspondingly
 * more cautious: identical-after-normalisation matches automatically, a very
 * close name matches automatically UNLESS the digits differ, and everything
 * else is either reviewed or created.
 */
export function matchStockItem(
  name: string,
  known: KnownStockItem[],
  resolutions?: MatchResolution[],
): MasterMatch {
  const normalized = normalizeStockItemName(name);
  if (!normalized) return { kind: "create" };

  // A human already answered this exact question — don't ask again.
  const resolved = resolutionFor(resolutions, "stock_item", normalized);
  if (resolved) {
    if (resolved.resolution === "distinct") return { kind: "create" };
    const chosen = known.find(
      (candidate) => deterministicGuid("stockitem", candidate.name.toLowerCase()) === resolved.matchedToGuid,
    );
    if (chosen) return { kind: "matched", name: chosen.name, reason: "resolution" };
  }

  const exact = known.filter((candidate) => normalizeStockItemName(candidate.name) === normalized);
  if (exact.length >= 1) {
    return { kind: "matched", name: exact[0].name, reason: "exact-name" };
  }

  const discriminators = discriminatorSignature(normalized);
  const scored = bestMatches(known, (candidate) => similarity(normalizeStockItemName(candidate.name), normalized), STOCK_REVIEW);
  if (scored.length === 0) return { kind: "create" };

  const best = scored[0];
  const bestDiscriminators = discriminatorSignature(normalizeStockItemName(best.candidate.name));
  const variantAgrees = discriminators === bestDiscriminators;

  if (best.score >= STOCK_AUTO_MATCH && variantAgrees) {
    return { kind: "matched", name: best.candidate.name, reason: "exact-name" };
  }

  return {
    kind: "review",
    message: variantAgrees
      ? `Possible duplicate stock item — confirm. "${name}" resembles ${scored
          .map((entry) => `"${entry.candidate.name}"`)
          .join(", ")}.`
      : `"${name}" resembles "${best.candidate.name}" but the sizes or grades in the name differ. Confirm whether these are the same item.`,
    candidates: scored.map((entry) => entry.candidate.name),
  };
}
