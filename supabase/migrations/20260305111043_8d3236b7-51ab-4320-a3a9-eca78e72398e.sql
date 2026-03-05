DELETE FROM liquidity_line_items
WHERE id NOT IN (
  SELECT DISTINCT ON (linked_invoice_id) id
  FROM liquidity_line_items
  WHERE linked_invoice_id IS NOT NULL
  ORDER BY linked_invoice_id, created_at ASC
)
AND linked_invoice_id IS NOT NULL;