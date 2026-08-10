CREATE TABLE IF NOT EXISTS public.item_match_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  raw_name_normalized text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('vendor', 'stock_item')),
  resolution text NOT NULL CHECK (resolution IN ('matched', 'distinct')),
  matched_to_guid text,
  resolved_by uuid NOT NULL REFERENCES auth.users(id),
  resolved_at timestamptz NOT NULL DEFAULT now(),
  source_bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,

  CONSTRAINT item_match_resolutions_guid_agrees CHECK (
    (resolution = 'matched' AND matched_to_guid IS NOT NULL)
    OR (resolution = 'distinct' AND matched_to_guid IS NULL)
  ),

  CONSTRAINT item_match_resolutions_one_answer UNIQUE (business_id, raw_name_normalized, item_type)
);

GRANT SELECT ON public.item_match_resolutions TO authenticated;
GRANT ALL ON public.item_match_resolutions TO service_role;

CREATE INDEX IF NOT EXISTS idx_item_match_resolutions_lookup
  ON public.item_match_resolutions (business_id, item_type);

COMMENT ON TABLE public.item_match_resolutions IS
  'Human judgments on ambiguous vendor/stock-item matches, keyed on the exact normalized name. Consulted before fuzzy matching; never written by automatic matching.';

ALTER TABLE public.item_match_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read item match resolutions"
  ON public.item_match_resolutions;
CREATE POLICY "Authenticated users can read item match resolutions"
  ON public.item_match_resolutions FOR SELECT
  TO authenticated
  USING (true);