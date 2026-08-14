/**
 * Company-membership checks for the user-facing edge functions.
 *
 * Worth being precise about what this module is. The functions that use it talk
 * to the database through serviceClient(), which carries the service-role key
 * and therefore BYPASSES RLS entirely. So these checks are not a second layer
 * behind the database's own — for these code paths they are the only layer.
 * A missing check here is a cross-tenant read or write, full stop.
 *
 * Deliberately NOT used by tally-agent-poll or tally-agent-report. Those
 * authenticate a desktop installation by its X-Agent-Token, have no user
 * session and no auth.uid() to check, and take their tenant from the agent row
 * instead. Adding a membership check there would reject every legitimate call.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "./agent-auth.ts";

/**
 * The caller is authenticated, but has no claim on the company they asked for.
 * Distinct from an authentication failure: 403, not 401. Retrying with the same
 * credentials will never help, and the client should not treat it as a blip.
 */
export class CompanyAccessError extends Error {}

/**
 * One message for every denial, whatever the underlying reason — not a member,
 * resource belongs elsewhere, resource has no company at all.
 *
 * Saying which would let someone probe for the existence and ownership of rows
 * they cannot read, by reading the error text rather than the data.
 */
export const COMPANY_ACCESS_DENIED = "Unauthorized — user does not have access to this company.";

export type Caller =
  /** An internal call carrying the service-role key. No user behind it. */
  | { kind: "service" }
  | { kind: "user"; id: string; email?: string };

/**
 * Resolves who is calling.
 *
 * Mirrors requireUserOrService, but returns the identity rather than discarding
 * it — the membership check below needs the user id, which that helper throws
 * away. Anything that is not the service key must resolve to a real user;
 * requireUser rejects the anon key, which is a valid JWT with nobody behind it.
 */
export async function authenticateCaller(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (serviceKey && token === serviceKey) return { kind: "service" };

  const user = await requireUser(req);
  return { kind: "user", id: user.id, email: user.email };
}

/**
 * Requires that the caller belongs to `companyId`.
 *
 * Service-role callers pass without a check, because there is no user to check.
 * That is safe only while every function holding the service key does its own
 * membership check before forwarding — bill-generate-tally and
 * resolve-item-match both do, before they call tally-enqueue. If a new caller
 * is added that does not, this becomes a hole rather than a shortcut.
 */
export async function requireCompanyMembership(
  supabase: SupabaseClient,
  caller: Caller,
  companyId: string,
): Promise<void> {
  if (caller.kind === "service") return;

  if (!companyId) throw new CompanyAccessError(COMPANY_ACCESS_DENIED);

  const { data, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", caller.id)
    .eq("company_id", companyId)
    .maybeSingle();

  // A failed lookup is not permission. Surface it rather than treating an
  // unreadable membership table as "probably fine".
  if (error) throw error;
  if (!data) throw new CompanyAccessError(COMPANY_ACCESS_DENIED);
}

/**
 * Resolves the company for a caller who is CREATING a row, where there is no
 * existing resource to read the company from.
 *
 * bill-extract can take the company off the bill it is processing.
 * gmail-sync creates the bill, so there is nothing to read it from — the
 * company has to come from the caller instead.
 *
 * Refuses rather than guesses when the caller belongs to more than one
 * company. Silently taking the first membership would file one company's bills
 * into another's books, and an accounting error that nobody is told about is
 * far worse than an error the caller can act on.
 */
export async function resolveCallerCompany(
  supabase: SupabaseClient,
  userId: string,
  claimedCompanyId?: string | null,
): Promise<string> {
  if (claimedCompanyId) {
    await requireCompanyMembership(supabase, { kind: "user", id: userId }, claimedCompanyId);
    return claimedCompanyId;
  }

  const { data, error } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId);

  if (error) throw error;

  const ids = (data ?? []).map((row) => row.company_id as string);
  if (ids.length === 0) throw new CompanyAccessError(COMPANY_ACCESS_DENIED);
  if (ids.length > 1) {
    throw new CompanyAccessError(
      "You belong to more than one company — pass companyId to say which this sync is for.",
    );
  }

  return ids[0];
}

/**
 * Decides which company a request is really operating on, given the row it
 * names and the company the client claimed.
 *
 * The resource is authoritative and the claim is only ever a cross-check. This
 * ordering is the point of the function: checking membership of a
 * client-supplied companyId ALONE proves nothing, because the client picks it.
 * Someone could send another company's billId alongside their own companyId,
 * pass the membership check cleanly, and act on a bill they cannot see.
 * Deriving the company from the bill and checking membership of THAT closes it.
 *
 * A mismatch is therefore a real signal — either a client bug or someone
 * probing — and is refused rather than quietly resolved in the row's favour.
 */
export function resolveResourceCompany(
  resourceCompanyId: string | null | undefined,
  claimedCompanyId: string | null | undefined,
  resourceLabel: string,
): string {
  if (!resourceCompanyId) {
    // Pre-migration rows, or a table whose backfill missed one. Refusing is the
    // only safe reading: there is no company to check membership against.
    console.error(`company-auth: ${resourceLabel} has no company_id; refusing.`);
    throw new CompanyAccessError(COMPANY_ACCESS_DENIED);
  }

  if (claimedCompanyId && claimedCompanyId !== resourceCompanyId) {
    console.error(
      `company-auth: claimed company ${claimedCompanyId} does not own ${resourceLabel}; refusing.`,
    );
    throw new CompanyAccessError(COMPANY_ACCESS_DENIED);
  }

  return resourceCompanyId;
}
