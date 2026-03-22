ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'partial';