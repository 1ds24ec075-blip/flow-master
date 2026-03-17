
-- Add fingerprint column for cross-upload deduplication to bank_transactions
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS fingerprint text;

-- Backfill fingerprints for existing rows
UPDATE public.bank_transactions
SET fingerprint = CONCAT(
  COALESCE(transaction_date::text, ''),
  '|',
  COALESCE(ROUND(amount::numeric, 2)::text, '0'),
  '|',
  COALESCE(transaction_type, ''),
  '|',
  LEFT(LOWER(TRIM(REGEXP_REPLACE(COALESCE(description, ''), '\s+', ' ', 'g'))), 100)
)
WHERE fingerprint IS NULL;

-- Create unique index on bank_transactions
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_fingerprint ON public.bank_transactions (fingerprint) WHERE fingerprint IS NOT NULL;

-- Add fingerprint column to segregated_transactions
ALTER TABLE public.segregated_transactions ADD COLUMN IF NOT EXISTS fingerprint text;

-- Backfill fingerprints
UPDATE public.segregated_transactions
SET fingerprint = CONCAT(
  COALESCE(transaction_date::text, ''),
  '|',
  COALESCE(ROUND(amount::numeric, 2)::text, '0'),
  '|',
  COALESCE(transaction_type, ''),
  '|',
  LEFT(LOWER(TRIM(REGEXP_REPLACE(COALESCE(narration, ''), '\s+', ' ', 'g'))), 100)
);

-- Delete duplicate segregated_transactions keeping only the oldest per fingerprint
DELETE FROM public.segregated_transactions
WHERE id NOT IN (
  SELECT DISTINCT ON (fingerprint) id
  FROM public.segregated_transactions
  WHERE fingerprint IS NOT NULL
  ORDER BY fingerprint, created_at ASC
);

-- Now create unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_segregated_transactions_fingerprint ON public.segregated_transactions (fingerprint) WHERE fingerprint IS NOT NULL;
