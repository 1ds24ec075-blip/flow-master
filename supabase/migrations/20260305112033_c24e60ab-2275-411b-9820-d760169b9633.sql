
-- Delete line items for duplicate weeks (keep oldest per week_start_date)
DELETE FROM liquidity_line_items
WHERE liquidity_week_id NOT IN (
  SELECT DISTINCT ON (week_start_date) id
  FROM weekly_liquidity
  ORDER BY week_start_date, created_at ASC
);

-- Delete duplicate weeks
DELETE FROM weekly_liquidity
WHERE id NOT IN (
  SELECT DISTINCT ON (week_start_date) id
  FROM weekly_liquidity
  ORDER BY week_start_date, created_at ASC
);

-- Delete weeks that don't start on a Sunday (day_of_week 0)
-- These are invalid under the new Sun-Sat cycle
DELETE FROM liquidity_line_items
WHERE liquidity_week_id IN (
  SELECT id FROM weekly_liquidity
  WHERE EXTRACT(DOW FROM week_start_date::date) != 0
);

DELETE FROM weekly_liquidity
WHERE EXTRACT(DOW FROM week_start_date::date) != 0;
