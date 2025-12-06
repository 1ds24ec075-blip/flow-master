/*
  # Gmail Integration Tables

  1. New Tables
    - `gmail_integrations`
      - `id` (uuid, primary key)
      - `user_id` (uuid) - User who connected Gmail
      - `email_address` (text) - Connected Gmail address
      - `access_token` (text) - Encrypted OAuth access token
      - `refresh_token` (text) - Encrypted OAuth refresh token
      - `token_expiry` (timestamptz) - When access token expires
      - `history_id` (text) - Gmail history ID for incremental sync
      - `watch_expiration` (timestamptz) - When Gmail watch expires
      - `is_active` (boolean) - Whether integration is active
      - `last_sync_at` (timestamptz) - Last successful sync timestamp
      - `sync_status` (text) - current sync status (active, error, disconnected)
      - `error_message` (text) - Last error message if any
      - `subject_filters` (text[]) - Array of subject keywords to match
      - `sender_filters` (text[]) - Array of sender emails/domains to filter
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `processed_emails`
      - `id` (uuid, primary key)
      - `integration_id` (uuid, foreign key to gmail_integrations)
      - `email_id` (text) - Gmail message ID
      - `thread_id` (text) - Gmail thread ID
      - `subject` (text) - Email subject
      - `sender` (text) - Email sender
      - `received_at` (timestamptz) - When email was received
      - `processed_at` (timestamptz) - When email was processed
      - `status` (text) - processing status (pending, success, failed)
      - `error_message` (text) - Error message if processing failed
      - `attachments_count` (integer) - Number of attachments processed
      - `bills_created` (integer) - Number of bills created from this email
      - `created_at` (timestamptz)
    
    - Add `email_source_id` to bills table to link bills to source emails

  2. Security
    - Enable RLS on all tables
    - Users can only access their own Gmail integrations
    - Users can only see processed emails from their integrations
    - Service role can access all records for webhook processing

  3. Indexes
    - Index on email_id for fast lookup
    - Index on integration_id for filtering
    - Index on processed_at for sorting
*/

-- Create gmail_integrations table
CREATE TABLE IF NOT EXISTS gmail_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email_address text NOT NULL,
  access_token text DEFAULT '',
  refresh_token text DEFAULT '',
  token_expiry timestamptz,
  history_id text DEFAULT '',
  watch_expiration timestamptz,
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  sync_status text DEFAULT 'active',
  error_message text DEFAULT '',
  subject_filters text[] DEFAULT ARRAY['invoice', 'bill', 'receipt'],
  sender_filters text[] DEFAULT ARRAY[]::text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, email_address)
);

-- Create processed_emails table
CREATE TABLE IF NOT EXISTS processed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid REFERENCES gmail_integrations(id) ON DELETE CASCADE,
  email_id text NOT NULL,
  thread_id text DEFAULT '',
  subject text DEFAULT '',
  sender text DEFAULT '',
  received_at timestamptz DEFAULT now(),
  processed_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending',
  error_message text DEFAULT '',
  attachments_count integer DEFAULT 0,
  bills_created integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(integration_id, email_id)
);

-- Add email_source_id to bills table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bills' AND column_name = 'email_source_id'
  ) THEN
    ALTER TABLE bills ADD COLUMN email_source_id uuid REFERENCES processed_emails(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE gmail_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_emails ENABLE ROW LEVEL SECURITY;

-- Policies for gmail_integrations
CREATE POLICY "Users can view own Gmail integrations"
  ON gmail_integrations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own Gmail integrations"
  ON gmail_integrations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own Gmail integrations"
  ON gmail_integrations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own Gmail integrations"
  ON gmail_integrations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policies for processed_emails
CREATE POLICY "Users can view processed emails from their integrations"
  ON processed_emails FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM gmail_integrations
      WHERE gmail_integrations.id = processed_emails.integration_id
      AND gmail_integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert processed emails"
  ON processed_emails FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update processed emails"
  ON processed_emails FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_gmail_integrations_user_id ON gmail_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_gmail_integrations_is_active ON gmail_integrations(is_active);
CREATE INDEX IF NOT EXISTS idx_processed_emails_integration_id ON processed_emails(integration_id);
CREATE INDEX IF NOT EXISTS idx_processed_emails_email_id ON processed_emails(email_id);
CREATE INDEX IF NOT EXISTS idx_processed_emails_status ON processed_emails(status);
CREATE INDEX IF NOT EXISTS idx_processed_emails_processed_at ON processed_emails(processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_email_source_id ON bills(email_source_id);

-- Create updated_at trigger for gmail_integrations
DROP TRIGGER IF EXISTS update_gmail_integrations_updated_at ON gmail_integrations;
CREATE TRIGGER update_gmail_integrations_updated_at
  BEFORE UPDATE ON gmail_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();