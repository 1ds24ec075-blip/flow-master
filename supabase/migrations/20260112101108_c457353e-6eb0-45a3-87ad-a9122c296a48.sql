-- Add banking fields to suppliers table for payment matching
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS bank_account text,
ADD COLUMN IF NOT EXISTS bank_name text,
ADD COLUMN IF NOT EXISTS upi_payment_patterns text;

COMMENT ON COLUMN public.suppliers.bank_account IS 'Supplier bank account number for payment matching';
COMMENT ON COLUMN public.suppliers.bank_name IS 'Supplier bank name';
COMMENT ON COLUMN public.suppliers.upi_payment_patterns IS 'Comma-separated UPI IDs or payment reference patterns for matching';