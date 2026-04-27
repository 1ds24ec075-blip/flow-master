-- Phase 1: Multi-tenant Gmail integrations

-- 1. Add user_id columns
ALTER TABLE public.gmail_integrations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.processed_emails
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS gmail_integrations_user_email_unique
  ON public.gmail_integrations(user_id, email_address)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS processed_emails_user_id_idx
  ON public.processed_emails(user_id);

-- 3. Drop permissive policies
DROP POLICY IF EXISTS "Allow all operations on gmail_integrations" ON public.gmail_integrations;
DROP POLICY IF EXISTS "Allow all operations on processed_emails" ON public.processed_emails;

-- 4. Strict per-user RLS for gmail_integrations
CREATE POLICY "Users view own gmail integrations"
  ON public.gmail_integrations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own gmail integrations"
  ON public.gmail_integrations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own gmail integrations"
  ON public.gmail_integrations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own gmail integrations"
  ON public.gmail_integrations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 5. Strict per-user RLS for processed_emails
CREATE POLICY "Users view own processed emails"
  ON public.processed_emails FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own processed emails"
  ON public.processed_emails FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own processed emails"
  ON public.processed_emails FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own processed emails"
  ON public.processed_emails FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);