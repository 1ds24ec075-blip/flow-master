
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing schedules if re-running
DO $$ BEGIN
  PERFORM cron.unschedule('daily-morning-brief');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('daily-cash-forecast');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 12:00 PM IST = 06:30 UTC
SELECT cron.schedule(
  'daily-morning-brief',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url:='https://pskuxhpfohmxlhmupeoz.supabase.co/functions/v1/morning-brief',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBza3V4aHBmb2hteGxobXVwZW96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NzgxMjksImV4cCI6MjA4MDE1NDEyOX0.3ptldlb9sGXhYllFAe__Y73B51S-amUOeYIksXpDlx8"}'::jsonb,
    body:='{"scheduled": true}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'daily-cash-forecast',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url:='https://pskuxhpfohmxlhmupeoz.supabase.co/functions/v1/cash-crisis-predictor',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBza3V4aHBmb2hteGxobXVwZW96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NzgxMjksImV4cCI6MjA4MDE1NDEyOX0.3ptldlb9sGXhYllFAe__Y73B51S-amUOeYIksXpDlx8"}'::jsonb,
    body:='{"scheduled": true}'::jsonb
  );
  $$
);
