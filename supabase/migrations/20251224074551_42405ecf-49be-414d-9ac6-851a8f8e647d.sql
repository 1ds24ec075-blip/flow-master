-- Make business_name optional with default in segregation_uploads
ALTER TABLE public.segregation_uploads 
ALTER COLUMN business_name SET DEFAULT 'Default Business',
ALTER COLUMN business_name DROP NOT NULL;

-- Make account_name optional with default in segregation_uploads
ALTER TABLE public.segregation_uploads 
ALTER COLUMN account_name SET DEFAULT 'Primary Account',
ALTER COLUMN account_name DROP NOT NULL;

-- Make business_name optional with default in segregation_rules
ALTER TABLE public.segregation_rules 
ALTER COLUMN business_name SET DEFAULT 'Default Business',
ALTER COLUMN business_name DROP NOT NULL;