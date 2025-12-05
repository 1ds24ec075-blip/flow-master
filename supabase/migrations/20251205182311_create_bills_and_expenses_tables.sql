/*
  # Bills and Expenses Management System

  1. New Tables
    - `expense_categories`
      - `id` (uuid, primary key)
      - `name` (text) - Category name (e.g., Office Supplies, Travel, Utilities)
      - `description` (text) - Category description
      - `color` (text) - Color code for visual representation
      - `is_active` (boolean) - Whether category is active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `bills`
      - `id` (uuid, primary key)
      - `bill_number` (text) - Bill/receipt number
      - `vendor_name` (text) - Name of the vendor/merchant
      - `vendor_gst` (text) - GST number if available
      - `bill_date` (date) - Date on the bill
      - `due_date` (date) - Payment due date if applicable
      - `subtotal` (decimal) - Amount before tax
      - `tax_amount` (decimal) - Tax amount
      - `total_amount` (decimal) - Total amount including tax
      - `currency` (text) - Currency code (default INR)
      - `payment_status` (text) - paid, pending, overdue
      - `payment_date` (date) - Date when payment was made
      - `payment_method` (text) - Cash, card, UPI, etc.
      - `category_id` (uuid, foreign key to expense_categories)
      - `description` (text) - Additional notes or description
      - `image_url` (text) - URL to uploaded bill image
      - `extraction_confidence` (decimal) - AI extraction confidence score
      - `is_verified` (boolean) - Manual verification status
      - `verified_by` (uuid) - User who verified
      - `verified_at` (timestamptz) - Verification timestamp
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `expense_line_items`
      - `id` (uuid, primary key)
      - `bill_id` (uuid, foreign key to bills)
      - `item_description` (text) - Description of the item
      - `quantity` (decimal) - Quantity purchased
      - `unit_price` (decimal) - Price per unit
      - `tax_rate` (decimal) - Tax rate percentage
      - `amount` (decimal) - Total amount for this line
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their bills
    - Add policies to view expense reports
*/

-- Create expense categories table
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  color text DEFAULT '#6366f1',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create bills table
CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number text DEFAULT '',
  vendor_name text DEFAULT '',
  vendor_gst text DEFAULT '',
  bill_date date DEFAULT CURRENT_DATE,
  due_date date,
  subtotal decimal(15,2) DEFAULT 0,
  tax_amount decimal(15,2) DEFAULT 0,
  total_amount decimal(15,2) DEFAULT 0,
  currency text DEFAULT 'INR',
  payment_status text DEFAULT 'pending',
  payment_date date,
  payment_method text DEFAULT '',
  category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  description text DEFAULT '',
  image_url text DEFAULT '',
  extraction_confidence decimal(5,2) DEFAULT 0,
  is_verified boolean DEFAULT false,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create expense line items table
CREATE TABLE IF NOT EXISTS expense_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid REFERENCES bills(id) ON DELETE CASCADE,
  item_description text DEFAULT '',
  quantity decimal(10,2) DEFAULT 1,
  unit_price decimal(15,2) DEFAULT 0,
  tax_rate decimal(5,2) DEFAULT 0,
  amount decimal(15,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_line_items ENABLE ROW LEVEL SECURITY;

-- Policies for expense_categories
CREATE POLICY "Anyone can view active expense categories"
  ON expense_categories FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Authenticated users can create expense categories"
  ON expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update expense categories"
  ON expense_categories FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete expense categories"
  ON expense_categories FOR DELETE
  TO authenticated
  USING (true);

-- Policies for bills
CREATE POLICY "Authenticated users can view all bills"
  ON bills FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create bills"
  ON bills FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update bills"
  ON bills FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete bills"
  ON bills FOR DELETE
  TO authenticated
  USING (true);

-- Policies for expense_line_items
CREATE POLICY "Authenticated users can view line items"
  ON expense_line_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create line items"
  ON expense_line_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update line items"
  ON expense_line_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete line items"
  ON expense_line_items FOR DELETE
  TO authenticated
  USING (true);

-- Insert default expense categories
INSERT INTO expense_categories (name, description, color) VALUES
  ('Office Supplies', 'Stationery, paper, and office equipment', '#3b82f6'),
  ('Travel & Transport', 'Travel expenses, fuel, and transportation', '#10b981'),
  ('Utilities', 'Electricity, water, internet, and phone bills', '#f59e0b'),
  ('Food & Dining', 'Meals, refreshments, and entertainment', '#ef4444'),
  ('Professional Services', 'Consultancy, legal, and professional fees', '#8b5cf6'),
  ('Maintenance & Repairs', 'Equipment maintenance and repairs', '#ec4899'),
  ('Marketing & Advertising', 'Marketing materials and advertising costs', '#06b6d4'),
  ('Miscellaneous', 'Other expenses not categorized', '#6b7280')
ON CONFLICT DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_bills_bill_date ON bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_bills_payment_status ON bills(payment_status);
CREATE INDEX IF NOT EXISTS idx_bills_category_id ON bills(category_id);
CREATE INDEX IF NOT EXISTS idx_bills_vendor_name ON bills(vendor_name);
CREATE INDEX IF NOT EXISTS idx_expense_line_items_bill_id ON expense_line_items(bill_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update_expense_categories_updated_at ON expense_categories;
CREATE TRIGGER update_expense_categories_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bills_updated_at ON bills;
CREATE TRIGGER update_bills_updated_at
  BEFORE UPDATE ON bills
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();