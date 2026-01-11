-- Add banking information columns to customer_master
ALTER TABLE public.customer_master 
ADD COLUMN bank_account TEXT,
ADD COLUMN upi_payment_patterns TEXT,
ADD COLUMN bank_name TEXT;