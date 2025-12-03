/*
  # Bank Statement Parser Tables

  1. New Tables
    - `bank_statements`
      - `id` (uuid, primary key)
      - `file_name` (text) - original filename
      - `file_path` (text) - storage path
      - `status` (text) - processing status (pending, processing, completed, failed)
      - `parsed_data` (jsonb) - full parsed JSON response
      - `uploaded_at` (timestamptz)
      - `processed_at` (timestamptz)
      - `error_message` (text, nullable)
    
    - `bank_transactions`
      - `id` (uuid, primary key)
      - `statement_id` (uuid, foreign key)
      - `transaction_date` (date)
      - `description` (text)
      - `amount` (decimal)
      - `transaction_type` (text) - credit or debit
      - `created_at` (timestamptz)
    
    - `expense_matches`
      - `id` (uuid, primary key)
      - `transaction_id` (uuid, foreign key)
      - `expense_name` (text)
      - `matched_amount` (decimal)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
*/

CREATE TABLE IF NOT EXISTS bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_path text,
  status text NOT NULL DEFAULT 'pending',
  parsed_data jsonb,
  uploaded_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  error_message text
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid REFERENCES bank_statements(id) ON DELETE CASCADE,
  transaction_date date,
  description text,
  amount decimal(15, 2),
  transaction_type text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES bank_transactions(id) ON DELETE CASCADE,
  expense_name text NOT NULL,
  matched_amount decimal(15, 2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on bank_statements"
  ON bank_statements FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on bank_transactions"
  ON bank_transactions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on expense_matches"
  ON expense_matches FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_statement_id ON bank_transactions(statement_id);
CREATE INDEX IF NOT EXISTS idx_expense_matches_transaction_id ON expense_matches(transaction_id);
