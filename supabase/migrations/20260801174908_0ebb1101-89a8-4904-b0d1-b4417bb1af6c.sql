-- 1. Revoke EXECUTE from PUBLIC (the implicit grant that lets anon run these)
--    on every SECURITY DEFINER function in the public schema.
REVOKE EXECUTE ON FUNCTION public.auto_add_supplier_invoice_to_liquidity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_duplicate_po_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_po_invoice_amount_mismatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_ledger_entry_for_bank_transaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_ledger_entry_for_client_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_ledger_entry_for_supplier_invoice() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_conversation_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_customer_gst_format() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_gst_format() FROM PUBLIC, anon, authenticated;

-- 2. Tally sync queue RPCs: server-side only (edge functions use the service role).
REVOKE EXECUTE ON FUNCTION public.claim_tally_jobs(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_stale_tally_jobs(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tally_jobs(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_stale_tally_jobs(interval) TO service_role;

-- 3. is_admin is used inside RLS policies, so signed-in users must keep EXECUTE.
--    Anonymous callers must not.
REVOKE EXECUTE ON FUNCTION public.is_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(text) TO authenticated, service_role;

-- 4. Trigger functions still need to be callable by their owner/service role.
GRANT EXECUTE ON FUNCTION public.auto_add_supplier_invoice_to_liquidity() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_duplicate_po_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.check_po_invoice_amount_mismatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_ledger_entry_for_bank_transaction() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_ledger_entry_for_client_invoice() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_ledger_entry_for_supplier_invoice() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_conversation_timestamp() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_customer_gst_format() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_gst_format() TO service_role;

-- 5. Prevent future functions in public from being auto-executable by anon.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;