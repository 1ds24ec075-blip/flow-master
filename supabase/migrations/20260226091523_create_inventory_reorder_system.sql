/*
  # Automated Inventory Reorder & Supplier Notification System

  ## Summary
  Creates the full inventory management system for MSME workflow automation.

  ## New Tables

  ### 1. inventory_items
  - Tracks all inventory items with stock levels and thresholds
  - Links to suppliers for reorder automation
  - Fields: item name, SKU, current quantity, minimum threshold, preferred supplier, default reorder quantity, unit, lead time

  ### 2. reorder_requests
  - Records every reorder triggered (manual or automatic)
  - Tracks status lifecycle: pending → sent → acknowledged → confirmed → delivered
  - Linked to inventory_items and suppliers
  - Captures who triggered it and when

  ### 3. supplier_communications
  - Logs all emails and communications sent to suppliers
  - Stores email subject, body, sent timestamp, and linked reorder request

  ## Security
  - RLS enabled on all three tables
  - Authenticated users can perform full CRUD
  - Public access denied by default
*/

-- =====================
-- inventory_items table
-- =====================
CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name text NOT NULL,
  sku text NOT NULL,
  current_quantity numeric NOT NULL DEFAULT 0,
  minimum_threshold numeric NOT NULL DEFAULT 0,
  default_reorder_quantity numeric NOT NULL DEFAULT 1,
  preferred_supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  unit text DEFAULT 'units',
  estimated_lead_time_days integer DEFAULT NULL,
  notes text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inventory items"
  ON inventory_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert inventory items"
  ON inventory_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update inventory items"
  ON inventory_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete inventory items"
  ON inventory_items FOR DELETE
  TO authenticated
  USING (true);

-- =====================
-- reorder_requests table
-- =====================
CREATE TABLE IF NOT EXISTS reorder_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  quantity_requested numeric NOT NULL,
  quantity_at_trigger numeric NOT NULL,
  minimum_threshold_at_trigger numeric NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'acknowledged', 'confirmed', 'delivered')),
  internal_note text DEFAULT '',
  requested_delivery_date date DEFAULT (now() + interval '7 days'),
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE reorder_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view reorder requests"
  ON reorder_requests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert reorder requests"
  ON reorder_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update reorder requests"
  ON reorder_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete reorder requests"
  ON reorder_requests FOR DELETE
  TO authenticated
  USING (true);

-- ==========================
-- supplier_communications table
-- ==========================
CREATE TABLE IF NOT EXISTS supplier_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reorder_request_id uuid REFERENCES reorder_requests(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  communication_type text NOT NULL DEFAULT 'email' CHECK (communication_type IN ('email', 'sms', 'whatsapp', 'manual')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  recipient_email text DEFAULT '',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'pending')),
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE supplier_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view supplier communications"
  ON supplier_communications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert supplier communications"
  ON supplier_communications FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update supplier communications"
  ON supplier_communications FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete supplier communications"
  ON supplier_communications FOR DELETE
  TO authenticated
  USING (true);

-- ====================================
-- Indexes for performance
-- ====================================
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier ON inventory_items(preferred_supplier_id);
CREATE INDEX IF NOT EXISTS idx_reorder_requests_item ON reorder_requests(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_reorder_requests_status ON reorder_requests(status);
CREATE INDEX IF NOT EXISTS idx_supplier_comms_reorder ON supplier_communications(reorder_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_comms_supplier ON supplier_communications(supplier_id);
