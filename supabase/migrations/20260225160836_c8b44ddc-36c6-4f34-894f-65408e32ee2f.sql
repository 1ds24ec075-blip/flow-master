
CREATE OR REPLACE FUNCTION public.auto_add_supplier_invoice_to_liquidity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  week_record RECORD;
BEGIN
  -- Only act if due_date is set and status is pending/awaiting_approval
  IF NEW.due_date IS NOT NULL AND NEW.status IN ('pending', 'awaiting_approval') THEN
    -- Find any liquidity week that covers this due_date (week_start_date to week_start_date + 6 days)
    FOR week_record IN
      SELECT id FROM weekly_liquidity
      WHERE NEW.due_date >= week_start_date
        AND NEW.due_date <= (week_start_date + INTERVAL '6 days')::date
    LOOP
      -- Check if this invoice is already linked in that week
      IF NOT EXISTS (
        SELECT 1 FROM liquidity_line_items
        WHERE linked_invoice_id = NEW.id
          AND linked_invoice_type = 'supplier'
          AND liquidity_week_id = week_record.id
      ) THEN
        INSERT INTO liquidity_line_items (
          liquidity_week_id, item_type, description, expected_amount,
          linked_invoice_id, linked_invoice_type, status, due_date
        )
        SELECT
          week_record.id,
          'payment',
          'Supplier: ' || COALESCE(s.name, 'Unknown') || ' — Inv#' || NEW.invoice_number,
          COALESCE(NEW.amount, 0),
          NEW.id,
          'supplier',
          'pending',
          NEW.due_date
        FROM suppliers s
        WHERE s.id = NEW.supplier_id
        UNION ALL
        SELECT
          week_record.id,
          'payment',
          'Supplier: Unknown — Inv#' || NEW.invoice_number,
          COALESCE(NEW.amount, 0),
          NEW.id,
          'supplier',
          'pending',
          NEW.due_date
        WHERE NEW.supplier_id IS NULL;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger on INSERT and UPDATE of raw_material_invoices
CREATE TRIGGER trg_auto_add_supplier_invoice_to_liquidity
  AFTER INSERT OR UPDATE OF due_date, status, amount
  ON public.raw_material_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_add_supplier_invoice_to_liquidity();
