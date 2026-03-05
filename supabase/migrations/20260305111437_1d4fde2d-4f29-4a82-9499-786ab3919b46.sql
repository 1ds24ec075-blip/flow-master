-- Delete duplicate weeks, keeping only the oldest per week_start_date
DELETE FROM liquidity_line_items
WHERE liquidity_week_id NOT IN (
  SELECT DISTINCT ON (week_start_date) id
  FROM weekly_liquidity
  ORDER BY week_start_date, created_at ASC
);

DELETE FROM weekly_liquidity
WHERE id NOT IN (
  SELECT DISTINCT ON (week_start_date) id
  FROM weekly_liquidity
  ORDER BY week_start_date, created_at ASC
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE weekly_liquidity ADD CONSTRAINT unique_week_start_date UNIQUE (week_start_date);