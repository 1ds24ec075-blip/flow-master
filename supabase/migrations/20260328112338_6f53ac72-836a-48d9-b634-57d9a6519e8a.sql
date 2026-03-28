
-- 1. Duplicate PO number prevention trigger
CREATE OR REPLACE FUNCTION public.check_duplicate_po_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.po_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.po_orders
    WHERE po_number = NEW.po_number
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND status NOT IN ('rejected', 'deleted')
  ) THEN
    RAISE EXCEPTION 'Duplicate PO number: % already exists', NEW.po_number;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_duplicate_po_number
  BEFORE INSERT OR UPDATE ON public.po_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.check_duplicate_po_number();

-- 2. GST format validation trigger for bills
CREATE OR REPLACE FUNCTION public.validate_gst_format()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.vendor_gst IS NOT NULL AND NEW.vendor_gst != '' THEN
    IF NEW.vendor_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' THEN
      RAISE EXCEPTION 'Invalid GST number format: %. Expected format: 22AAAAA0000A1Z5', NEW.vendor_gst;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_gst_bills
  BEFORE INSERT OR UPDATE ON public.bills
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_gst_format();

-- 3. GST validation for customer_master
CREATE OR REPLACE FUNCTION public.validate_customer_gst_format()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.gst_number IS NOT NULL AND NEW.gst_number != '' THEN
    IF NEW.gst_number !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' THEN
      RAISE EXCEPTION 'Invalid GST number format: %. Expected format: 22AAAAA0000A1Z5', NEW.gst_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_gst_customer_master
  BEFORE INSERT OR UPDATE ON public.customer_master
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_customer_gst_format();

-- 4. PO-Invoice amount mismatch detection - store alerts in activity_log
CREATE OR REPLACE FUNCTION public.check_po_invoice_amount_mismatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  po_amount numeric;
  difference_pct numeric;
BEGIN
  IF NEW.po_id IS NOT NULL AND NEW.amount IS NOT NULL THEN
    SELECT p.amount INTO po_amount
    FROM public.purchase_orders p
    WHERE p.id = NEW.po_id;

    IF po_amount IS NOT NULL AND po_amount > 0 THEN
      difference_pct := ABS(NEW.amount - po_amount) / po_amount * 100;
      
      IF difference_pct > 5 THEN
        INSERT INTO public.activity_log (
          activity_type, entity_type, entity_id, status, metadata
        ) VALUES (
          'amount_mismatch_alert',
          'invoice',
          NEW.id::text,
          'warning',
          jsonb_build_object(
            'invoice_number', NEW.invoice_number,
            'invoice_amount', NEW.amount,
            'po_amount', po_amount,
            'difference_percent', round(difference_pct, 2),
            'po_id', NEW.po_id
          )
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_amount_mismatch_client_invoices
  AFTER INSERT OR UPDATE ON public.client_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.check_po_invoice_amount_mismatch();

CREATE TRIGGER trg_check_amount_mismatch_raw_material_invoices
  AFTER INSERT OR UPDATE ON public.raw_material_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.check_po_invoice_amount_mismatch();
